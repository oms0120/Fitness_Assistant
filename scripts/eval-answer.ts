/**
 * 端到端答案侧评测（LLM-as-judge）。
 *
 *   npx tsx scripts/eval-answer.ts [--golden <path>] [--limit N] [--concurrency N]
 *                                  [--out <path>] [--show-low N] [--repeat N] [--dry-run]
 *
 * 链路：golden 的 question → `askWithRag()`（真实检索 + 真实 prompt）→ `chatJson()` 让模型
 * 按 `answerJudgementSchema` 打分。**不复制 prompt、不复制检索**，测的就是线上那条路径。
 *
 * 前置：
 *   - `DEEPSEEK_API_KEY` 或 `ANTHROPIC_API_KEY`（从仓库根 `.env` 兜底读，见下方 loadEnv）
 *   - rag-service 已在跑：`cd rag-service && .venv/Scripts/python -m uvicorn server:app --port 8000`
 *
 * 怎么读这份报告：
 *   faithfulness 低                  → 模型在编，改 prompt / 缩上下文
 *   sufficiency 低                   → 片段答不了这个问题，改检索（**这才是检索失败的信号**）
 *   faithfulness 高 + sufficiency 低  → 典型形态是「如实说无法回答」：没编，但也没答上
 *   三个都高但用户觉得不对            → 错在检索给出的片段本身（表格误读之类），评测口径没覆盖到
 *
 * ⚠️ **单跑一轮的分差不是信号。噪声底实测如下**（同配置重跑两遍 dense，110 条）：
 *      sufficiency 有 21/110 条发生变动，幅度 ±1~±2；均值 4.645 vs 4.633（差 0.012）。
 *    也就是说**逐条 ±1 分、均值 ±0.05 这个量级的变化，同配置重跑就能造出来**。生成和评审
 *    都有采样，n=110 分辨不到那个精度。
 *    `--repeat N` 就是为这件事加的：每条问 N 次评审，逐轴取中位（见 aggregateJudgements），
 *    报告里另外给出 `n_unstable` —— 采样之间不一致的条数，即这一轮自己的噪声底。
 *    **要比两版配置，先各跑一遍 `--repeat 3`，再只看幅度 ≥2 且两轮同向的条目。**
 *    **唯一稳定可比的量是「弃答集合」**：dense 两轮都是 `{strength-025, strength-026,
 *    diet-034, diet-050}`，一条不差 —— s=1 是个离散档，噪声推不动它。弃答数的变化可以信。
 *
 * ⚠️ 这三个分数都不衡量「答案对不对」。schema 里没有「与参考答案是否一致」这一项，
 *    正确性由 `run_retrieval_eval.py` 的召回指标 + 人工复核覆盖。别当正确率用。
 */
import fs from "node:fs";
import path from "node:path";

import {
  JUDGE_PROMPT_VERSION,
  RAG_PROMPT_VERSION,
  judgeSystemPrompt,
  judgeUserPrompt,
} from "@/lib/ai/prompts";
import { answerJudgementSchema, type AnswerJudgement } from "@/lib/ai/types";
import { chatJson, resolveMode } from "@/lib/ai/llm";
import { ragUrl } from "@/lib/rag/ragClient";
import { askWithRag, formatChunks } from "@/lib/rag/ragService";

// 脚本在 Next 之外跑，没人替我们加载 .env。先读 .env.local 再读 .env —— 与 Next 的
// 优先级一致（前者的变量优先），因为 loadEnvFile 不覆盖已存在的变量、shell 里的值优先。
for (const file of [".env.local", ".env"]) {
  try {
    process.loadEnvFile(file);
  } catch {
    // 文件不存在就跳过
  }
}

const DEFAULT_GOLDEN = "rag-service/eval/golden.jsonl";

interface GoldenRecord {
  id: string;
  question: string;
  reference_answer: string;
  gold_chunk_ids: number[];
  category: string;
  difficulty: string;
}

interface Row {
  id: string;
  question: string;
  reference_answer: string;
  gold_chunk_ids: number[];
  category: string;
  difficulty: string;
  /** 召回的 top-5 里是否含 golden 标定的片段。gold 为空的条目（unanswerable）记 null。 */
  context_hit: boolean | null;
  retrieved: { id: number; source: string; score: number }[];
  answer: string | null;
  judgement: AnswerJudgement | null;
  /**
   * `--repeat N` 时保留每条的全部采样（逐轴分数），供事后算这一轮自己的噪声底。
   * repeat=1 时只有一项，等价于旧行为。judgement 只是这些采样的聚合结果，原始值必须留着 ——
   * 只存聚合值的话，「这条到底稳不稳」就再也回看不出来了。
   */
  judge_samples: { faithfulness: number; relevance: number; sufficiency: number }[];
  answer_ms: number | null;
  error: string | null;
}

// ---------- 命令行参数 ----------

const argv = process.argv.slice(2);

function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = argv[i + 1];
  return next === undefined || next.startsWith("--") ? "" : next;
}

function num(name: string, fallback: number): number {
  const raw = flag(name);
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function die(message: string): never {
  console.error(`[eval] ${message}`);
  process.exit(2);
}

// ---------- 读入与探针 ----------

function loadGolden(file: string): GoldenRecord[] {
  if (!fs.existsSync(file)) {
    die(`找不到 ${file}。先跑 rag-service/eval/build_golden.py 生成候选，人工校验后写入。`);
  }
  const records: GoldenRecord[] = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (line.trim()) records.push(JSON.parse(line) as GoldenRecord);
  }
  if (records.length === 0) {
    die(`${file} 是空的。见 rag-service/eval/golden.schema.md —— 候选集未经人工校验不能当 golden 用。`);
  }
  return records;
}

/**
 * 探一次 RAG 服务。不能用 `searchChunks` 代替：那个函数把「服务没起」和「检索不到」
 * 都吞成空数组，量出来会是一堆「模型如实说不知道」的高分假象。
 *
 * 顺带把服务实际用的检索模式读回来。**这是唯一可靠的来源** —— `askWithRag` 走的是
 * `searchChunks`，不传 mode，用哪个模式由服务端默认值决定；脚本这边猜一个写进文件名，
 * dense 和 hybrid 的报告就会盖在一起。
 */
async function probeRag(): Promise<{ ok: boolean; detail: string; mode: string }> {
  const url = ragUrl();
  try {
    const res = await fetch(`${url}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "蛋白质", top_k: 1 }),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}`, mode: "?" };
    const data = (await res.json()) as { results?: unknown[]; error?: string; mode?: string };
    // 服务端用 200 + error 表达「检索不到」，这里要把 error 显式读出来（ragClient 会吞掉它）
    if (data.error) return { ok: false, detail: data.error, mode: data.mode ?? "?" };
    if (!data.results?.length) {
      return { ok: false, detail: "检索返回空，vectors.db 可能是空的，先跑 ingest.py", mode: data.mode ?? "?" };
    }
    return { ok: true, detail: url, mode: data.mode ?? "?" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `连不上 ${url}：${msg}`, mode: "?" };
  }
}

/** 定并发的 map：不引依赖，够用就行。fn 自己吞异常，所以这里不用管 rejection。 */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

// ---------- 单条评测 ----------

/**
 * 调评审，schema 校验失败就重试一次。
 * 失败率约 1%（110 条里 1 条返回了缺字段的对象），而一次失败的代价是整条记录从统计里
 * 消失（109/110）—— 多一次调用换回一条数据，划算。
 */
async function judgeOnce(payload: {
  question: string;
  answer: string;
  context: string;
}): Promise<AnswerJudgement> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await chatJson({
        system: judgeSystemPrompt(),
        user: judgeUserPrompt(payload),
        schema: answerJudgementSchema,
        maxTokens: 1024,
        promptVersion: JUDGE_PROMPT_VERSION,
      });
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

/**
 * 把同一条的 N 次评审采样合成一个判断，**逐轴取中位**。
 *
 * 为什么是中位而不是严格多数票：5 分制、N=3 时完全可能三个值互不相同（如 1/2/5），
 * 严格多数不存在。中位在那种情况下仍然有定义，而在存在多数时中位就等于多数值 ——
 * 它是多数票的超集。偶数 N 同理（取中间两个的均值），但偶数没有"中间那一次"，
 * 所以 `--repeat` 强制取奇数。
 *
 * 三个轴**各自独立**取中位，不做联合。联合取"最接近的那次采样"会让一个轴的
 * 波动把另外两个轴也拖过去，反而放大噪声。
 *
 * reasoning 不能跟着拼 —— 三个轴分别取中位后组合出来的理由，评委从没说过。
 * 取实际采样里离中位向量最近的那一次的原文，宁可带一点偏差也不编造。
 */
function aggregateJudgements(samples: AnswerJudgement[]): AnswerJudgement {
  if (samples.length === 1) return samples[0];

  const pick = (axis: keyof AnswerJudgement) => median(samples.map((s) => s[axis] as number));
  const agg = {
    faithfulness: pick("faithfulness"),
    relevance: pick("relevance"),
    sufficiency: pick("sufficiency"),
  };

  const distance = (s: AnswerJudgement) =>
    Math.abs(s.faithfulness - agg.faithfulness) +
    Math.abs(s.relevance - agg.relevance) +
    Math.abs(s.sufficiency - agg.sufficiency);
  const closest = samples.reduce((best, s) => (distance(s) < distance(best) ? s : best));

  return { ...agg, reasoning: closest.reasoning };
}

/**
 * 调评审 N 次并聚合。`--repeat 1` 时与单次调用等价。
 *
 * 采样允许失败：单次失败率约 1%，N=3 时要求三次全成会把失败率推到 3%，白丢记录。
 * 用 allSettled，只要成功数过半就聚合 —— 成功数不过半时"中位"已经不代表多数意见了，
 * 宁可让这条记 error 也不要报一个假的确定值。
 */
async function judgeRepeated(
  payload: { question: string; answer: string; context: string },
  repeat: number,
): Promise<{ judgement: AnswerJudgement; samples: AnswerJudgement[] }> {
  const settled = await Promise.allSettled(
    Array.from({ length: repeat }, () => judgeOnce(payload)),
  );
  const ok = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (ok.length < Math.ceil(repeat / 2)) {
    const first = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    throw first?.reason ?? new Error(`评审采样只成功 ${ok.length}/${repeat} 次`);
  }
  return { judgement: aggregateJudgements(ok), samples: ok };
}

async function evaluateOne(rec: GoldenRecord, repeat: number): Promise<Row> {
  const base = {
    id: rec.id,
    question: rec.question,
    reference_answer: rec.reference_answer,
    gold_chunk_ids: rec.gold_chunk_ids ?? [],
    category: rec.category ?? "?",
    difficulty: rec.difficulty ?? "?",
  };
  const empty: Row = {
    ...base,
    context_hit: null,
    retrieved: [],
    answer: null,
    judgement: null,
    judge_samples: [],
    answer_ms: null,
    error: null,
  };

  try {
    const started = Date.now();
    const result = await askWithRag(rec.question);
    const answerMs = Date.now() - started;

    // 评审看到的是 result.chunks 经 formatChunks 渲染的结果 —— 与生成时注入的上下文同一份渲染
    const { judgement, samples } = await judgeRepeated(
      {
        question: rec.question,
        answer: result.answer,
        context: formatChunks(result.chunks),
      },
      repeat,
    );

    const gold = new Set(base.gold_chunk_ids);
    return {
      ...base,
      context_hit: gold.size ? result.chunks.some((c) => gold.has(c.id)) : null,
      retrieved: result.chunks.map((c) => ({ id: c.id, source: c.source, score: c.score })),
      answer: result.answer,
      judgement,
      judge_samples: samples.map((s) => ({
        faithfulness: s.faithfulness,
        relevance: s.relevance,
        sufficiency: s.sufficiency,
      })),
      answer_ms: answerMs,
      error: null,
    };
  } catch (e) {
    return { ...empty, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- 汇总 ----------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 1-5 分各档的条数，没出现的档也补 0，便于直接比较两份报告 */
function distribution(scores: number[]): Record<string, number> {
  const out: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const s of scores) out[String(s)] = (out[String(s)] ?? 0) + 1;
  return out;
}

/** 三个轴的均值。集中在一处，免得每加一个轴要在 summary 里改五处。 */
function means(rows: Row[]) {
  const j = rows.map((r) => r.judgement!);
  return {
    faithfulness_mean: mean(j.map((x) => x.faithfulness)),
    relevance_mean: mean(j.map((x) => x.relevance)),
    sufficiency_mean: mean(j.map((x) => x.sufficiency)),
  };
}

function summarize(rows: Row[]) {
  const ok = rows.filter((r) => r.judgement !== null);
  const dist = (pick: (j: AnswerJudgement) => number) => distribution(ok.map((r) => pick(r.judgement!)));

  const group = (hit: boolean) => {
    const g = ok.filter((r) => r.context_hit === hit);
    // 分组里必须带 sufficiency 的分布：均值会把「弃答（1 分）」和「答全了（5 分）」平摊成 3 分，
    // 而弃答是二值形态 —— 未命中组里 s=1 堆了多少条，才是检索失败的直接读数。
    return { n: g.length, ...means(g), sufficiency_dist: distribution(g.map((r) => r.judgement!.sufficiency)) };
  };

  return {
    n_records: rows.length,
    n_scored: ok.length,
    n_errors: rows.length - ok.length,
    n_unanswerable: rows.filter((r) => r.context_hit === null).length,
    ...means(ok),
    faithfulness_dist: dist((j) => j.faithfulness),
    relevance_dist: dist((j) => j.relevance),
    sufficiency_dist: dist((j) => j.sufficiency),
    context_hit: group(true),
    context_miss: group(false),
    answer_ms_median: median(ok.map((r) => r.answer_ms ?? 0).filter((x) => x > 0)),
    /**
     * 采样之间 sufficiency 不一致的条数 —— **这一轮自己的噪声底**。
     * repeat=1 时恒为 0，但那不是"稳定"，是没测。别把它读成 0 噪声。
     * 只在 sufficiency 上算：faithfulness 在这个语料上常年满分，拿它判稳定性没有分辨力。
     */
    n_unstable: ok.filter((r) => new Set(r.judge_samples.map((s) => s.sufficiency)).size > 1).length,
  };
}

// ---------- 主流程 ----------

async function main() {
  const goldenPath = flag("golden") || DEFAULT_GOLDEN;
  const limit = num("limit", 0);
  const concurrency = num("concurrency", 4);
  const showLow = num("show-low", 5);
  const repeat = num("repeat", 1);
  const dryRun = flag("dry-run") !== undefined;

  // 偶数次采样没有"中间那一次"，aggregateJudgements 的中位就变成两次的均值 ——
  // 那是个插值出来的分数，不是任何一次真实判断。直接拒掉，别让它悄悄进报告。
  if (!Number.isInteger(repeat) || repeat < 1 || repeat % 2 === 0) {
    die(`--repeat 必须是正奇数，收到 ${repeat}。偶数次采样没有中位可言，聚合出来的是插值分数`);
  }

  const mode = resolveMode();
  if (mode === "rule") {
    die("未配置大模型 key（DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY），无法跑答案侧评测");
  }
  const probe = await probeRag();
  if (!probe.ok) {
    die(`RAG 服务不可用：${probe.detail}\n      cd rag-service && .venv/Scripts/python -m uvicorn server:app --port 8000`);
  }

  let records = loadGolden(goldenPath);
  if (limit > 0) records = records.slice(0, limit);
  console.log(`[eval] golden: ${goldenPath}（${records.length} 条）`);
  console.log(`[eval] backend: ${mode} / RAG @ ${probe.detail}`);
  console.log(`[eval] prompt 版本: rag ${RAG_PROMPT_VERSION} / judge ${JUDGE_PROMPT_VERSION} / 检索 ${probe.mode}`);
  if (repeat > 1) {
    console.log(`[eval] --repeat ${repeat}：每条问 ${repeat} 次评审取中位，调用量 ${repeat}×`);
  }

  if (dryRun) {
    console.log("[eval] --dry-run：只检查接线，不调模型。首条：", records[0].id, records[0].question);
    return;
  }

  const started = Date.now();
  let done = 0;
  const rows = await mapPool(records, concurrency, async (rec) => {
    const row = await evaluateOne(rec, repeat);
    done += 1;
    const tag = row.error
      ? `失败 ${row.error.slice(0, 60)}`
      : `f=${row.judgement!.faithfulness} r=${row.judgement!.relevance} s=${row.judgement!.sufficiency}`;
    console.log(`[eval] ${String(done).padStart(3)}/${records.length} ${rec.id.padEnd(14)} ${tag}`);
    return row;
  });

  const summary = summarize(rows);
  const hit = summary.context_hit;
  const miss = summary.context_miss;

  console.log("\n[eval] 汇总");
  console.log(`  已评 ${summary.n_scored} / ${summary.n_records} 条，失败 ${summary.n_errors} 条`);
  console.log(`  faithfulness 均值 ${summary.faithfulness_mean.toFixed(2)}  分布 ${JSON.stringify(summary.faithfulness_dist)}`);
  console.log(`  relevance    均值 ${summary.relevance_mean.toFixed(2)}  分布 ${JSON.stringify(summary.relevance_dist)}`);
  console.log(`  sufficiency  均值 ${summary.sufficiency_mean.toFixed(2)}  分布 ${JSON.stringify(summary.sufficiency_dist)}`);
  console.log(
    `  召回命中(片段含 gold) n=${hit.n}  faithfulness ${hit.faithfulness_mean.toFixed(2)} / relevance ${hit.relevance_mean.toFixed(2)} / sufficiency ${hit.sufficiency_mean.toFixed(2)}`,
  );
  console.log(`       sufficiency 分布 ${JSON.stringify(hit.sufficiency_dist)}`);
  console.log(
    `  召回未命中           n=${miss.n}  faithfulness ${miss.faithfulness_mean.toFixed(2)} / relevance ${miss.relevance_mean.toFixed(2)} / sufficiency ${miss.sufficiency_mean.toFixed(2)}`,
  );
  console.log(`       sufficiency 分布 ${JSON.stringify(miss.sufficiency_dist)}`);
  // 单看命中/未命中的 sufficiency 均值会把 1 分和 5 分平摊成 3 分，看不出「弃答」这个二值形态。
  // 两组的分布并排才是检索失败的读数：未命中组里 s=1 堆积了多少条。
  console.log(`  单次问答中位耗时 ${(summary.answer_ms_median / 1000).toFixed(1)} s（仅 askWithRag，不含评审调用）`);
  console.log(
    repeat > 1
      ? `  采样不一致 ${summary.n_unstable} / ${summary.n_scored} 条（${repeat} 次评审里 sufficiency 不唯一）—— 这就是本轮噪声底，比它小的分差别当结论`
      : `  采样不一致 未测（--repeat 1）。要判两版配置的差异，先各跑 --repeat 3`,
  );

  const errors = rows.filter((r) => r.error);
  if (errors.length) {
    console.log(`\n[eval] 失败 ${errors.length} 条`);
    for (const r of errors) console.log(`  ${r.id}: ${r.error}`);
  }

  if (showLow > 0) {
    // 排序键取三个轴的最小值。**必须含 sufficiency**：弃答（5/5/1）在两个旧轴上都是满分，
    // 用 min(f, r) 排的话它们永远浮不上来 —— 而它们恰恰是最该看的一批。
    const worstOf = (j: AnswerJudgement) => Math.min(j.faithfulness, j.relevance, j.sufficiency);
    const worst = rows
      .filter((r) => r.judgement)
      .sort(
        (a, b) =>
          worstOf(a.judgement!) - worstOf(b.judgement!) ||
          a.judgement!.sufficiency - b.judgement!.sufficiency ||
          a.judgement!.faithfulness - b.judgement!.faithfulness,
      )
      .slice(0, showLow);
    if (worst.length) {
      console.log(`\n[eval] 最低分前 ${worst.length} 条`);
      for (const r of worst) {
        const j = r.judgement!;
        // 采样不一致时把原始分打出来：中位掩盖了分歧，而分歧正是"这条的分数不可信"的标志
        const spread = repeat > 1 ? ` s采样[${r.judge_samples.map((s) => s.sufficiency).join(",")}]` : "";
        console.log(`  ${r.id}  f=${j.faithfulness} r=${j.relevance} s=${j.sufficiency}${spread}  召回${r.context_hit ? "命中" : "未命中"}  ${r.question}`);
        console.log(`     回答: ${(r.answer ?? "").replace(/\s+/g, " ").slice(0, 100)}`);
        console.log(`     评审: ${j.reasoning.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
  }

  // 文件名必须带上 judge 版本、检索模式和采样次数：这三样变了，数就不可比。
  // repeat=1 时省掉后缀，好让历史文件名保持有效。
  const out =
    flag("out") ||
    path.join(
      "eval-reports",
      `${new Date().toISOString().slice(0, 10)}-rag${RAG_PROMPT_VERSION}-judge${JUDGE_PROMPT_VERSION}-${probe.mode}${repeat > 1 ? `-r${repeat}` : ""}-answer.json`,
    );
  fs.mkdirSync(path.dirname(out) || ".", { recursive: true });
  fs.writeFileSync(
    out,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        golden: goldenPath,
        prompt_versions: { rag: RAG_PROMPT_VERSION, judge: JUDGE_PROMPT_VERSION },
        backend: mode,
        rag_service: probe.detail,
        retrieval_mode: probe.mode,
        judge_repeat: repeat,
        elapsed_ms: Date.now() - started,
        summary,
        rows,
      },
      null,
      2,
    ),
  );
  console.log(`\n[eval] 报告已写入 ${out}`);

  // 一条都没评上说明链路是坏的，让 CI / 调用方能靠退出码发现
  if (summary.n_scored === 0) process.exit(1);
}

main().catch((e) => {
  console.error("[eval] 未预期的错误：", e);
  process.exit(1);
});

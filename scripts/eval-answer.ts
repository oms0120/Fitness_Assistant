/**
 * 端到端答案侧评测（LLM-as-judge）。
 *
 *   npx tsx scripts/eval-answer.ts [--golden <path>] [--limit N] [--concurrency N]
 *                                  [--out <path>] [--show-low N] [--dry-run]
 *
 * 链路：golden 的 question → `askWithRag()`（真实检索 + 真实 prompt）→ `chatJson()` 让模型
 * 按 `answerJudgementSchema` 打分。**不复制 prompt、不复制检索**，测的就是线上那条路径。
 *
 * 前置：
 *   - `DEEPSEEK_API_KEY` 或 `ANTHROPIC_API_KEY`（从仓库根 `.env` 兜底读，见下方 loadEnv）
 *   - rag-service 已在跑：`cd rag-service && .venv/Scripts/python -m uvicorn server:app --port 8000`
 *
 * 怎么读这份报告：
 *   faithfulness 低            → 模型在编，改 prompt / 缩上下文
 *   faithfulness 高 relevance 低 → 片段答不了这个问题，改检索
 *   两者都高但用户觉得不对      → 说明错在检索给出的片段本身（表格误读之类），评测口径没覆盖到
 *
 * ⚠️ 这两个分数都不衡量「答案对不对」。schema 里没有「与参考答案是否一致」这一项，
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
 */
async function probeRag(): Promise<{ ok: boolean; detail: string }> {
  const url = ragUrl();
  try {
    const res = await fetch(`${url}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "蛋白质", top_k: 1 }),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const data = (await res.json()) as { results?: unknown[]; error?: string };
    // 服务端用 200 + error 表达「检索不到」，这里要把 error 显式读出来（ragClient 会吞掉它）
    if (data.error) return { ok: false, detail: data.error };
    if (!data.results?.length) return { ok: false, detail: "检索返回空，vectors.db 可能是空的，先跑 ingest.py" };
    return { ok: true, detail: url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: `连不上 ${url}：${msg}` };
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

async function evaluateOne(rec: GoldenRecord): Promise<Row> {
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
    answer_ms: null,
    error: null,
  };

  try {
    const started = Date.now();
    const result = await askWithRag(rec.question);
    const answerMs = Date.now() - started;

    // 评审看到的是 result.chunks 经 formatChunks 渲染的结果 —— 与生成时注入的上下文同一份渲染
    const judgement = await chatJson({
      system: judgeSystemPrompt(),
      user: judgeUserPrompt({
        question: rec.question,
        answer: result.answer,
        context: formatChunks(result.chunks),
      }),
      schema: answerJudgementSchema,
      maxTokens: 1024,
      promptVersion: JUDGE_PROMPT_VERSION,
    });

    const gold = new Set(base.gold_chunk_ids);
    return {
      ...base,
      context_hit: gold.size ? result.chunks.some((c) => gold.has(c.id)) : null,
      retrieved: result.chunks.map((c) => ({ id: c.id, source: c.source, score: c.score })),
      answer: result.answer,
      judgement,
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

function summarize(rows: Row[]) {
  const ok = rows.filter((r) => r.judgement !== null);
  const faithfulness = ok.map((r) => r.judgement!.faithfulness);
  const relevance = ok.map((r) => r.judgement!.relevance);

  const group = (hit: boolean) => {
    const g = ok.filter((r) => r.context_hit === hit);
    return {
      n: g.length,
      faithfulness: mean(g.map((r) => r.judgement!.faithfulness)),
      relevance: mean(g.map((r) => r.judgement!.relevance)),
    };
  };

  return {
    n_records: rows.length,
    n_scored: ok.length,
    n_errors: rows.length - ok.length,
    n_unanswerable: rows.filter((r) => r.context_hit === null).length,
    faithfulness_mean: mean(faithfulness),
    relevance_mean: mean(relevance),
    faithfulness_dist: distribution(faithfulness),
    relevance_dist: distribution(relevance),
    context_hit: group(true),
    context_miss: group(false),
    answer_ms_median: median(ok.map((r) => r.answer_ms ?? 0).filter((x) => x > 0)),
  };
}

// ---------- 主流程 ----------

async function main() {
  const goldenPath = flag("golden") || DEFAULT_GOLDEN;
  const limit = num("limit", 0);
  const concurrency = num("concurrency", 4);
  const showLow = num("show-low", 5);
  const dryRun = flag("dry-run") !== undefined;

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
  console.log(`[eval] prompt 版本: rag ${RAG_PROMPT_VERSION} / judge ${JUDGE_PROMPT_VERSION}`);

  if (dryRun) {
    console.log("[eval] --dry-run：只检查接线，不调模型。首条：", records[0].id, records[0].question);
    return;
  }

  const started = Date.now();
  let done = 0;
  const rows = await mapPool(records, concurrency, async (rec) => {
    const row = await evaluateOne(rec);
    done += 1;
    const tag = row.error ? `失败 ${row.error.slice(0, 60)}` : `f=${row.judgement!.faithfulness} r=${row.judgement!.relevance}`;
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
  console.log(
    `  召回命中(片段含 gold) n=${hit.n}  faithfulness ${hit.faithfulness.toFixed(2)} / relevance ${hit.relevance.toFixed(2)}`,
  );
  console.log(
    `  召回未命中           n=${miss.n}  faithfulness ${miss.faithfulness.toFixed(2)} / relevance ${miss.relevance.toFixed(2)}`,
  );
  console.log(`  单次问答+评审中位耗时 ${(summary.answer_ms_median / 1000).toFixed(1)} s（仅 askWithRag，不含评审调用）`);

  const errors = rows.filter((r) => r.error);
  if (errors.length) {
    console.log(`\n[eval] 失败 ${errors.length} 条`);
    for (const r of errors) console.log(`  ${r.id}: ${r.error}`);
  }

  if (showLow > 0) {
    const worst = rows
      .filter((r) => r.judgement)
      .sort(
        (a, b) =>
          Math.min(a.judgement!.faithfulness, a.judgement!.relevance) -
            Math.min(b.judgement!.faithfulness, b.judgement!.relevance) ||
          a.judgement!.faithfulness - b.judgement!.faithfulness,
      )
      .slice(0, showLow);
    if (worst.length) {
      console.log(`\n[eval] 最低分前 ${worst.length} 条`);
      for (const r of worst) {
        const j = r.judgement!;
        console.log(`  ${r.id}  f=${j.faithfulness} r=${j.relevance}  召回${r.context_hit ? "命中" : "未命中"}  ${r.question}`);
        console.log(`     回答: ${(r.answer ?? "").replace(/\s+/g, " ").slice(0, 100)}`);
        console.log(`     评审: ${j.reasoning.replace(/\s+/g, " ").slice(0, 160)}`);
      }
    }
  }

  const out = flag("out") || path.join("eval-reports", `${new Date().toISOString().slice(0, 10)}-${RAG_PROMPT_VERSION}-answer.json`);
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

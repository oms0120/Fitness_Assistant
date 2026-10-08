/**
 * 三级降级的**真实验证**（定义见 docs/README.md 的「关键设计」第 3 条）。
 *
 * 与前两个 `verify-*.ts` 同一套路：走**真路由**、发**合法 body**、用**真 session**，
 * 看 HTTP 状态码和响应体，而不是信任单测里的 mock。
 *
 * ## 为什么要分开跑
 *
 * 三级各自的**前提环境不同**，env 是进程级的，所以每一级需要一套不同的服务端 env：
 *
 *   第 1 级（无 key → 规则库）        AI_PROVIDER=rule
 *   第 2 级（模型异常 → ？）          AI_PROVIDER=deepseek + 会报错的上游
 *   第 3 级（检索离线 → 无上下文）    需要一个**可用**的模型后端（rule 模式下 RAG 直接抛错）
 *
 * 第 2、3 级共用一套服务端 env（都指向本地 mock），只是 mock 的模式不同。
 *
 * ## 用法
 *
 *   # 终端 A：AI_PROVIDER=rule AI_RATE_LIMIT_PER_MIN=0 AI_DAILY_CALL_LIMIT=0 npm run dev
 *   npx tsx scripts/verify-degradation.ts rule
 *
 *   # 终端 A：AI_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-mock \
 *   #         DEEPSEEK_BASE_URL=http://127.0.0.1:8899 DEEPSEEK_RETRIES=0 \
 *   #         AI_RATE_LIMIT_PER_MIN=0 AI_DAILY_CALL_LIMIT=0 npm run dev
 *   npx tsx scripts/verify-degradation.ts model-error   # mock 切成 error500
 *   npx tsx scripts/verify-degradation.ts rag-on        # mock 恢复 healthy、rag-service 在跑
 *   npx tsx scripts/verify-degradation.ts rag-off       # mock 恢复 healthy、rag-service 停掉
 *
 * ## 环境变量
 *
 *   VERIFY_BASE_URL   默认 http://127.0.0.1:3000
 *
 * ## 副作用
 *
 * 会走公开的 `POST /api/register` 建一个 `degradation-smoke@example.com`
 * （已存在则容忍 409，可反复跑）。开 `AI_DAILY_CALL_LIMIT=0` 是为了让 mock 调用
 * 不消耗额度 —— 否则同一天反复验证会被预算拦成 429，看起来像降级失败。
 */
const BASE = (process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = "degradation-smoke@example.com";
const PASSWORD = "degradation-smoke-1234";

const RECIPE_BODY = { targetCalories: 2000, proteinRatio: 0.3, carbRatio: 0.4, fatRatio: 0.3, goal: "maintain" };
const PLAN_BODY = { muscleGroup: "胸", level: "beginner", equipment: "gym" };
const ASK_BODY = { question: "蛋白质摄入量应该怎么算？" };

const jar = new Map<string, string>();

function storeCookies(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    if (/max-age=0/i.test(raw)) jar.delete(name);
    else jar.set(name, pair.slice(eq + 1).trim());
  }
}

const cookieHeader = (): string => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");

async function post(path: string, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieHeader() },
    body: JSON.stringify(body),
  });
  let parsed: Record<string, unknown> = {};
  try {
    parsed = (await res.json()) as Record<string, unknown>;
  } catch {
    /* 非 JSON 错误体无所谓 */
  }
  return { status: res.status, body: parsed };
}

async function ensureSession(): Promise<void> {
  const reg = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (reg.status !== 200 && reg.status !== 409) throw new Error(`注册失败：${reg.status}`);

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  storeCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: BASE }),
    redirect: "manual",
  });
  storeCookies(loginRes);

  const probe = await post("/api/ai/recipes", {});
  if (probe.status === 401) throw new Error("登录没生效，拿到的仍是 401");
}

/** 缩略一行，避免把整个 prompt 打进终端。 */
const brief = (v: unknown, n = 120): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s === undefined ? "" : s.length > n ? `${s.slice(0, n)}…` : s;
};

async function main(): Promise<void> {
  const scenario = process.argv[2];
  if (!scenario) throw new Error("用法：verify-degradation.ts <rule|model-error|rag-on|rag-off>");

  await ensureSession();
  const out: Record<string, unknown> = { scenario };

  if (scenario === "rule") {
    const r = await post("/api/ai/recipes", RECIPE_BODY);
    out.recipes = { status: r.status, degraded: r.body.degraded, first: brief((r.body.suggestions as unknown[])?.[0]) };
    const p = await post("/api/ai/plan", PLAN_BODY);
    out.plan = { status: p.status, degraded: p.body.degraded, name: (p.body.plan as Record<string, unknown>)?.name };
    // 交叉约束：rule 模式下 RAG 无规则库可降级 —— 这里应当**报错**，不是"无上下文问答"
    const a = await post("/api/rag/ask", ASK_BODY);
    out.ragUnderRule = { status: a.status, error: a.body.error };
  }

  if (scenario === "model-error") {
    // 两件事一起看：状态码（500 还是 200）和 `degraded`（有没有走兜底），
    // 以及产出到底是模型给的还是规则库给的 —— 只看状态码会漏掉"200 但内容是模板"。
    const r = await post("/api/ai/recipes", RECIPE_BODY);
    out.recipes = { status: r.status, degraded: r.body.degraded, error: r.body.error, hasSuggestions: Array.isArray(r.body.suggestions), first: brief((r.body.suggestions as unknown[])?.[0]) };
    const p = await post("/api/ai/plan", PLAN_BODY);
    out.plan = { status: p.status, degraded: p.body.degraded, error: p.body.error, hasPlan: Boolean(p.body.plan), name: (p.body.plan as Record<string, unknown>)?.name };
  }

  if (scenario === "rag-on" || scenario === "rag-off") {
    const a = await post("/api/rag/ask", ASK_BODY);
    out.ask = {
      status: a.status,
      error: a.body.error,
      sourceCount: Array.isArray(a.body.sources) ? (a.body.sources as string[]).length : null,
      sources: a.body.sources,
      answer: brief(a.body.answer, 200),
    };
  }

  console.log(JSON.stringify(out, null, 2));
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});

/**
 * 必须留这一行。没有 import/export 的 .ts 是**脚本**，顶层 `const` 落在全局作用域 ——
 * `verify-ratelimit.ts` 同样没有 import，两边的 `BASE` / `EMAIL` / `jar` 会撞成
 * 「Cannot redeclare block-scoped variable」，`tsc --noEmit` 直接红（CI 会拦）。
 * 加一个空导出把它变成模块，顶层名字就收进模块作用域了。
 */
export {};

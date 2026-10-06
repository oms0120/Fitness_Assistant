/**
 * 限流的**真实验证**：连续快速打同一个端点，看第几次开始返回 429。
 *
 * 这是「限流」这件事唯一没法靠 `npm test` 覆盖的部分 —— 单测能验令牌数学和
 * `createRateLimiter`，但**状态码、`Retry-After` 头、`reason` 字段**只有真发
 * HTTP 才看得到。
 *
 * ## 前置：另开一个终端起服务，阈值调低且走规则库（**不花钱**）
 *
 *   AI_PROVIDER=rule AI_RATE_LIMIT_PER_MIN=3 npm run dev
 *
 *   RATE_LIMIT_EXPECT=3 npx tsx scripts/verify-ratelimit.ts
 *
 * `AI_PROVIDER=rule` 是这套验证的关键：发的是**合法 body**、走的是**真路由**，
 * 但一次模型都不调。所以零成本，而且不依赖「限流排在解析 body 之前」这个顺序 ——
 * 靠畸形 body 省钱的写法测的是那个顺序，有人调换一下它就悄悄失效了。
 *
 * ## 副作用
 *
 * 会走公开的 `POST /api/register` 建一个 `ratelimit-smoke@example.com`。
 * 已存在就容忍 409（所以**可以反复跑**，不会每次多一个用户）。
 *
 * ## 环境变量
 *
 *   VERIFY_BASE_URL    默认 http://127.0.0.1:3000
 *   RATE_LIMIT_EXPECT  服务端 AI_RATE_LIMIT_PER_MIN 的值，默认 3。**必须对得上**。
 */
const BASE = (process.env.VERIFY_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const EXPECT = Number(process.env.RATE_LIMIT_EXPECT ?? 3);
const EMAIL = "ratelimit-smoke@example.com";
const PASSWORD = "ratelimit-smoke-1234";

/** 真实 body：走规则库时能拿到非空 suggestions，所以 200 是真的成功而不是空壳。 */
const RECIPE_BODY = {
  targetCalories: 2000,
  proteinRatio: 0.3,
  carbRatio: 0.4,
  fatRatio: 0.3,
  goal: "maintain",
};
const PLAN_BODY = { muscleGroup: "胸", level: "beginner", equipment: "gym" };

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`✗ ${message}`);
  console.log(`  ✓ ${message}`);
}

/**
 * 极简 cookie jar。Auth.js 的 csrf / session cookie 要跨请求带回去，
 * 而 Node 的 fetch 默认**不**保留 cookie（没有浏览器那套）。
 */
const jar = new Map<string, string>();

function storeCookies(res: Response): void {
  for (const raw of res.headers.getSetCookie()) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    // 过期即删：Auth.js 轮换/登出时会发 Max-Age=0
    if (/max-age=0/i.test(raw)) jar.delete(name);
    else jar.set(name, pair.slice(eq + 1).trim());
  }
}

function cookieHeader(): string {
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

function jsonHeaders(): Record<string, string> {
  const c = cookieHeader();
  return { "Content-Type": "application/json", ...(c ? { cookie: c } : {}) };
}

interface Attempt {
  status: number;
  retryAfter: string | null;
  reason?: string;
  suggestions?: number;
}

async function hit(path: string, body: unknown): Promise<Attempt> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  let parsed: { reason?: string; suggestions?: unknown[] } = {};
  try {
    parsed = (await res.json()) as typeof parsed;
  } catch {
    /* 429 之外的错误体可能不是 JSON，无所谓 */
  }
  return {
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
    reason: parsed.reason,
    suggestions: parsed.suggestions?.length,
  };
}

/** 注册（已存在则忽略），然后走完整的 csrf + credentials 登录，最后确认会话真的生效。 */
async function ensureSession(): Promise<void> {
  const reg = await fetch(`${BASE}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  check(
    reg.status === 200 || reg.status === 409,
    `注册 ${EMAIL}：${reg.status}（409 = 上次跑过了，正常）`,
  );

  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  storeCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  check(Boolean(csrfToken), "拿到 csrf token");

  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
    body: new URLSearchParams({ csrfToken, email: EMAIL, password: PASSWORD, callbackUrl: BASE }),
    // 手动跟重定向：要在 302 上收 Set-Cookie，跟过去反而看不到
    redirect: "manual",
  });
  storeCookies(loginRes);
  const location = loginRes.headers.get("location") ?? "";
  if (/[?&]error=/i.test(location)) {
    throw new Error(
      `登录被拒（${location}）。若这个邮箱上次用了别的密码，删掉该用户或改脚本里的 PASSWORD`,
    );
  }

  const sessionRes = await fetch(`${BASE}/api/auth/session`, { headers: jsonHeaders() });
  const session = (await sessionRes.json()) as { user?: { id?: string } };
  // 打印收到的 cookie 名，登录失败时不用猜
  check(Boolean(session?.user?.id), `会话生效（cookie: ${[...jar.keys()].join(", ")}）`);
}

async function main(): Promise<void> {
  console.log(`目标 ${BASE}，预期阈值 ${EXPECT} 次/分`);
  try {
    await fetch(`${BASE}/api/auth/session`);
  } catch {
    throw new Error(
      `连不上 ${BASE}。先另开一个终端起服务：\n` +
        `  AI_PROVIDER=rule AI_RATE_LIMIT_PER_MIN=${EXPECT} npm run dev`,
    );
  }

  console.log("\n[1] 预热三个路由，顺带确认都要登录");
  // 预热是必须的：Turbopack 首次请求要编译路由，那十几秒里桶会按时间白送令牌
  // （桶是按时间回补的），足以把临界点往后推一格。401 在限流**之前**返回，
  // 所以预热本身不消耗令牌。
  for (const [path, body] of [
    ["/api/ai/recipes", RECIPE_BODY],
    ["/api/ai/plan", PLAN_BODY],
    ["/api/rag/ask", { question: "预热" }],
  ] as const) {
    const r = await hit(path, body);
    check(r.status === 401, `${path} 无 cookie 是 401（${r.status}）`);
  }

  console.log("\n[2] 注册 + 登录");
  await ensureSession();

  console.log(`\n[3] 连续打 /api/ai/recipes ${EXPECT + 2} 次`);
  const results: Attempt[] = [];
  for (let i = 0; i < EXPECT + 2; i++) {
    const r = await hit("/api/ai/recipes", RECIPE_BODY);
    results.push(r);
    const extra = r.reason
      ? ` reason=${r.reason}`
      : r.suggestions !== undefined
        ? ` suggestions=${r.suggestions}`
        : "";
    console.log(
      `  · 第 ${i + 1} 次 → ${r.status}` +
        (r.retryAfter ? ` Retry-After=${r.retryAfter}s` : "") +
        extra,
    );
  }

  const firstDenied = results.findIndex((r) => r.status === 429);
  if (firstDenied < 0) {
    throw new Error(
      `一次都没限流。若 server 没带 AI_RATE_LIMIT_PER_MIN=${EXPECT}（默认是 10），` +
        `${EXPECT + 2} 次是打不穿的 —— 用上面那条命令重起。`,
    );
  }
  check(firstDenied === EXPECT, `第 ${EXPECT + 1} 次开始 429（实际第 ${firstDenied + 1} 次）`);

  const allowed = results.slice(0, firstDenied);
  check(
    allowed.every((r) => r.status === 200),
    `限流前的 ${allowed.length} 次都是 200`,
  );
  check(
    allowed.every((r) => r.suggestions !== undefined && r.suggestions > 0),
    "那些 200 不是空壳（规则库真返回了 suggestions）",
  );
  check(
    allowed.every((r) => r.reason === undefined),
    "200 的响应里没有 reason 字段 —— 只有 429 才有，客户端不会误判",
  );

  const denied = results.slice(firstDenied);
  check(denied.every((r) => r.status === 429), `之后 ${denied.length} 次全是 429，没有漏网的`);
  check(
    denied.every((r) => r.reason === "rate_limit"),
    'reason 是 "rate_limit"（和日预算的 "budget" 区分开）',
  );
  check(
    denied.every((r) => /^\d+$/.test(r.retryAfter ?? "") && Number(r.retryAfter) >= 1),
    `Retry-After 是 ≥1 的整数秒（${denied.map((r) => r.retryAfter).join(", ")}）`,
  );

  console.log("\n[4] 三个端点共用一桶");
  // 桶刚被 recipes 打空，plan 立刻也该被挡。这条验的是「共享一桶」这个设计决策 ——
  // 各自一桶的话 /api/ai/plan 会有一份独立的满桶，实际额度就变成 3 倍。
  const plan = await hit("/api/ai/plan", PLAN_BODY);
  console.log(`  · /api/ai/plan → ${plan.status}`);
  check(plan.status === 429 && plan.reason === "rate_limit", "换成 plan 端点照样 429");
}

main()
  .then(() => console.log("\n全部通过。"))
  .catch((err) => {
    console.error("\n失败：", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });

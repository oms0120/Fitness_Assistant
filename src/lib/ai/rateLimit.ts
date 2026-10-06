/**
 * 每用户令牌桶限流（进程内存版）。
 *
 * ## 它和 usage.ts 的日额度是两件事
 *
 * | | 日额度（usage.ts） | 本文件 |
 * |---|---|---|
 * | 防的是 | 长期成本失控 | 瞬时突发（脚本刷、前端重试循环、误连点） |
 * | 粒度 | 天 | 秒级 |
 * | 存储 | SQLite（`LlmUsageRecord`） | 进程内存 `Map` |
 * | 跨实例 | 共享（同一个 DB） | **每实例各算各的** |
 * | 重启 | 保留 | 清零 |
 *
 * 两个都会返回 429，客户端靠 body 里的 `reason` 区分（`"rate_limit"` / `"budget"`）。
 *
 * ## 单实例内存，多实例部署必须换 Redis
 *
 * 桶存在**进程内存**里，所以：
 *
 * - **N 个实例 = 实际额度 N 倍** —— 每个实例各有一份完整的桶。
 * - 同一个用户的请求散到不同实例上，各自都给他一份满桶，比 N 倍还松。
 * - `globalThis` 只解决**同进程内**的共享，跨实例一律无效。
 *
 * 这里能接受，是因为**单实例部署**；而且成本天花板另有其人 —— 日额度是 DB 支撑、
 * 跨实例共享的（虽然是软的，见 usage.ts 头部）。限流挡的是"一台机器上的突发"，
 * 兜住总账的是日额度。
 *
 * 真要修，把桶挪进 Redis。三种做法从糙到细：
 *
 * 1. `INCR` + `EXPIRE` 的固定窗口 —— 最简单，但窗口边界上能过到 2 倍量
 * 2. Lua 脚本在 Redis 里跑下面这套令牌算法 —— 正确，且天然原子
 * 3. `redis-cell` 模块 —— 现成的令牌桶
 *
 * **粘性会话是更弱的修法**：实例一换桶就重置，只是把"N 倍"缩成"换一次多一份"。
 *
 * 还有一层容易被忽略的：**edge / serverless 运行时**。哪个路由要是加了
 * `export const runtime = "edge"`，`globalThis` 会变成**每个 isolate 一份**，
 * 比多实例还碎。当前三个路由都没声明 `runtime`，走的是默认 Node 运行时。
 * （Next 自己的内存缓存文档说的是同一件事：每个进程一份、不跨实例共享。）
 *
 * ## 内存增长
 *
 * Map 以 userId 为键，只有认证过的用户能写。`sweep` 每隔一个窗口清一遍
 * 「`nowMs - updatedAt >= windowMs`」的条目 —— 这种桶的回流已经封顶在容量，
 * 和"从没见过的用户"**逐位等价**，所以删掉是精确的，不是近似。
 *
 * **不做 MAX_KEYS 硬上限。** 有 sweep 之后 Map 已经被限制在"窗口内活跃过的用户"，
 * 上限是多余的；而且"超上限就清空整张表"会让一个多账号的攻击者能顺手清掉
 * **其他用户**的活跃计数 —— 兜底机制不该有这种副作用。
 *
 * ## `enforce` 是 async，但内存实现里不能有 await
 *
 * 「读桶 → 回流 → 扣令牌 → 写桶」必须**同步**跑完。单线程事件循环下这才是原子的；
 * 中间插一个 `await` 就会让两个并发请求读到同一个桶。换 Redis 时同理 —— 那时得靠
 * `INCR` / Lua 保原子性，签名本身表达不了这件事。
 *
 * 那为什么还是 async？纯粹为了**换 Redis 时三个调用点不用改**（它们本来就在
 * `await auth()` 的上下文里）。代价要认：async 函数抛出是 **rejection**，调用点
 * 漏写 `await` 会变成静默的 unhandled rejection，而且**完全不设防**（fail-open 得
 * 悄无声息）。所以三个调用点都必须在 `try` 里。
 *
 * ## 测试覆盖到哪
 *
 * `npm test` 覆盖 `consumeToken` 纯函数和 `createRateLimiter` 的独立实例。
 * **路由层（429 状态码、`Retry-After` 头、`reason` 字段）不在 `npm test` 里** ——
 * 那需要一个真会话，由 `scripts/verify-ratelimit.ts` 对着真 HTTP 验。
 */
import { readInt } from "./resilience";

export interface RateLimitConfig {
  /** 桶容量，也就是窗口内允许的次数。`0` = **不限制**（不是「全拦」）。 */
  limit: number;
  /** 把空桶补满所需的时间。 */
  windowMs: number;
}

/** 令牌桶状态。opaque：只由 `consumeToken` 读写。 */
export interface Bucket {
  tokens: number;
  /** 上次结算时刻（ms epoch）。 */
  updatedAt: number;
}

export type RateLimitDecision =
  | { ok: true; bucket: Bucket }
  | { ok: false; retryAfterMs: number; bucket: Bucket };

export const DEFAULT_RATE_LIMIT_PER_MIN = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * 纯函数：不读时钟、不读 env、不碰 Map。`nowMs` 必须显式传（仓库惯例，
 * 见 `usage.ts` 的 `startOfDay`——测试绝不用 `vi.useFakeTimers`）。
 */
export function consumeToken(
  prev: Bucket | undefined,
  nowMs: number,
  cfg: RateLimitConfig,
): RateLimitDecision {
  // 两种情况都必须在算 refillPerMs **之前**返回：
  // - limit <= 0：capacity 为 0 会让首次请求就 tokens < 1 → 永远拒绝；
  //   而且 refillPerMs 也是 0 → retryAfterMs = ceil(1/0) = Infinity，会漏进响应头。
  // - windowMs <= 0：refillPerMs 是 Infinity，elapsed 为 0 时 0 * Infinity = NaN，
  //   而 NaN < 1 是 false → 放行，并把 NaN 写进桶，之后**永远放行**。
  if (cfg.limit <= 0 || cfg.windowMs <= 0) {
    return { ok: true, bucket: { tokens: 0, updatedAt: nowMs } };
  }

  const capacity = cfg.limit;
  const refillPerMs = capacity / cfg.windowMs;

  // 没见过的用户按**满桶**起算：第一次请求不该被当成欠费。
  const prevTokens = prev?.tokens ?? capacity;
  const prevAt = prev?.updatedAt ?? nowMs;

  // max(0, ...) 挡时钟回拨：回拨时按"没经过时间"算，不凭空补令牌。
  const elapsed = Math.max(0, nowMs - prevAt);
  const tokens = Math.min(capacity, prevTokens + elapsed * refillPerMs);

  // updatedAt 取 max 而不是直接写 nowMs：时钟回拨时若写 nowMs，后续按真实时间来的
  // 调用会从这个**更早**的戳开始算 elapsed，导致接下来一整个窗口都补不满。
  const updatedAt = Math.max(prevAt, nowMs);

  if (tokens < 1) {
    // 拒绝也要把**回补后**的 tokens 存回去，否则反复被拒的请求会累积幻影回流。
    return {
      ok: false,
      retryAfterMs: Math.ceil((1 - tokens) / refillPerMs),
      bucket: { tokens, updatedAt },
    };
  }
  return { ok: true, bucket: { tokens: tokens - 1, updatedAt } };
}

export class RateLimitedError extends Error {
  readonly retryAfterMs: number;
  readonly limit: number;
  readonly windowMs: number;

  constructor(retryAfterMs: number, limit: number, windowMs: number) {
    super(`请求过于频繁（上限 ${limit} 次 / ${Math.round(windowMs / 1000)} 秒）`);
    this.name = "RateLimitedError";
    this.retryAfterMs = retryAfterMs;
    this.limit = limit;
    this.windowMs = windowMs;
  }
}

/** `Retry-After` 要的是**秒**，向上取整，最小 1（「0 秒后再试」没有意义）。 */
export function retryAfterSeconds(err: RateLimitedError): number {
  return Math.max(1, Math.ceil(err.retryAfterMs / 1000));
}

/**
 * 懒读 env，不用模块级常量：脚本（`scripts/verify-ratelimit.ts`）是先 import 再
 * `process.loadEnvFile()`，模块级常量会在 .env 加载之前就把值读掉。同 usage.ts。
 *
 * **空串走默认值，不是 0。** `Number("")` 是 0，所以 `readInt("", 10, 0)` 返回 0，
 * 而 0 的含义是"不限制" —— `.env` 里一行空的 `AI_RATE_LIMIT_PER_MIN=`（或容器编排
 * 里透传的一个空变量）就会**静默关掉限流**。日额度那边"不限制"是安全方向，
 * 限流这边恰好相反，所以这里必须显式判空。
 */
export function rateLimitConfig(): RateLimitConfig {
  const raw = process.env.AI_RATE_LIMIT_PER_MIN;
  const limit = raw?.trim()
    ? readInt(raw, DEFAULT_RATE_LIMIT_PER_MIN, 0)
    : DEFAULT_RATE_LIMIT_PER_MIN;
  return { limit, windowMs: RATE_LIMIT_WINDOW_MS };
}

export interface RateLimiter {
  /** 超限就抛 `RateLimitedError`，否则什么都不做。 */
  enforce(userId: string, nowMs?: number): Promise<void>;
  /** 当前桶的数量。给测试和排查用。 */
  size(): number;
}

/**
 * 工厂：每实例自带一张 Map，所以测试能拿到互不干扰的干净状态，不用碰全局单例。
 * 对齐 `guardedProvider.ts` 的思路 —— 状态不外泄、依赖可注入。
 *
 * 收的是**配置提供者**而不是配置对象：构造时捕获会让"先 import 再 loadEnvFile"的
 * 脚本永远读到默认值（见 `rateLimitConfig` 的注释）。每次调用读一次 `readInt`，
 * 成本可以忽略。这也让验证脚本能靠改 `process.env` 驱动它（`verify-usage.ts`
 * 用的是同一个套路）。
 */
export function createRateLimiter(getConfig: () => RateLimitConfig = rateLimitConfig): RateLimiter {
  const buckets = new Map<string, Bucket>();
  /** 上次 sweep 的时刻。**不能**初始化为 0 之外的哨兵值，见下面 sweep 的判据。 */
  let lastSweepAt = 0;

  /**
   * 清掉已经回满的桶。`nowMs - updatedAt >= windowMs` 的桶，其 tokens 必然已经
   * 被 `min(capacity, ...)` 封顶在容量，和"从没见过的用户"逐位等价，所以删掉是
   * **精确**的 —— 包括被拒后残留的那个小数 tokens。
   */
  function sweep(nowMs: number, windowMs: number): void {
    if (nowMs - lastSweepAt < windowMs) return;
    lastSweepAt = nowMs;
    for (const [key, bucket] of buckets) {
      if (nowMs - bucket.updatedAt >= windowMs) buckets.delete(key);
    }
  }

  return {
    async enforce(userId: string, nowMs: number = Date.now()): Promise<void> {
      const cfg = getConfig();
      // 不限制时连 Map 都不碰 —— 也就没有任何内存增长。
      if (cfg.limit <= 0 || cfg.windowMs <= 0) return;

      // 这一段必须同步跑完，中间不能出现 await（见模块注释「enforce 是 async」）。
      const decision = consumeToken(buckets.get(userId), nowMs, cfg);
      buckets.set(userId, decision.bucket);
      // 刚写进去的桶 updatedAt 就是 nowMs，不会被自己扫掉。
      sweep(nowMs, cfg.windowMs);

      if (!decision.ok) {
        throw new RateLimitedError(decision.retryAfterMs, cfg.limit, cfg.windowMs);
      }
    },

    size(): number {
      return buckets.size;
    },
  };
}

/**
 * 模块单例，`globalThis` 支撑。
 *
 * 为什么不用普通的模块级 `const`：dev 下 HMR 会重新执行模块，普通常量会被换成一张
 * 空 Map，把桶全清零；`globalThis` 还能顺带不去依赖打包器的模块去重行为。
 * （实测本仓库的 Turbopack 产物是把共享模块放进同一个 chunk、`moduleCache` 每进程
 * 只实例化一次，所以"三个路由可能各拿一份"并不成立 —— 这里主要是防 HMR。）
 *
 * **无条件用**，不像 `prisma.ts` 只在非生产用：那边在生产靠"模块只求值一次"就够，
 * 这边我们希望任何环境下都是同一个实例。
 *
 * 它只保证**同进程**共享。多实例要 Redis，见模块注释。
 */
const globalForRateLimit = globalThis as unknown as { aiRateLimiter?: RateLimiter };

export function enforceRateLimit(userId: string, nowMs?: number): Promise<void> {
  globalForRateLimit.aiRateLimiter ??= createRateLimiter();
  return globalForRateLimit.aiRateLimiter.enforce(userId, nowMs);
}

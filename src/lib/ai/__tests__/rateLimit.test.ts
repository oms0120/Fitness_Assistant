/**
 * 令牌桶限流。
 *
 * 全部用**显式 `nowMs`**，不用 `vi.useFakeTimers`（仓库惯例，同 `usage.ts` 的
 * `startOfDay(now, tzOffsetMinutes)`）。`createRateLimiter()` 每个用例拿独立实例，
 * 所以不碰全局单例、用例之间没有顺序依赖。
 *
 * 路由层的 429 / `Retry-After` / `reason` **不在这里** —— 那要真会话，
 * 见 `scripts/verify-ratelimit.ts`。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_RATE_LIMIT_PER_MIN,
  RATE_LIMIT_WINDOW_MS,
  RateLimitedError,
  consumeToken,
  createRateLimiter,
  rateLimitConfig,
  retryAfterSeconds,
  type Bucket,
  type RateLimitConfig,
  type RateLimitDecision,
} from "@/lib/ai/rateLimit";

/** 10 次/分：容量 10，回流 1 个 / 6 秒。 */
const CFG: RateLimitConfig = { limit: 10, windowMs: 60_000 };

/** 从判定里取出拒绝分支，顺便让 TS 收窄类型。 */
function deny(decision: RateLimitDecision) {
  if (decision.ok) {
    throw new Error(`期望拒绝，实际放行（剩余 ${decision.bucket.tokens} 个令牌）`);
  }
  return decision;
}

/** 连打 `times` 次，返回最后一次的桶。 */
function drain(prev: Bucket | undefined, nowMs: number, times: number, cfg = CFG): Bucket {
  let bucket = prev;
  for (let i = 0; i < times; i++) {
    bucket = consumeToken(bucket, nowMs, cfg).bucket;
  }
  return bucket!;
}

describe("consumeToken", () => {
  it("没见过的用户按满桶起算——第一次请求不该被当成欠费", () => {
    const r = consumeToken(undefined, 0, CFG);
    expect(r.ok).toBe(true);
    expect(r.bucket.tokens).toBe(9); // 满桶 10 扣掉这一次
  });

  it("连续 limit 次放行，第 limit + 1 次拒", () => {
    let bucket: Bucket | undefined;
    for (let i = 0; i < CFG.limit; i++) {
      const r = consumeToken(bucket, 0, CFG);
      expect(r.ok).toBe(true);
      bucket = r.bucket;
    }
    expect(consumeToken(bucket, 0, CFG).ok).toBe(false);
  });

  it("拒的时候 retryAfterMs 就是补出一个令牌要等的时间", () => {
    // 空桶、10 次/分 → 1 / 6000 个每 ms → 补 1 个要 6000 ms
    const r = deny(consumeToken({ tokens: 0, updatedAt: 0 }, 0, CFG));
    expect(r.retryAfterMs).toBe(6_000);
  });

  it("时间推进按速率部分回补，不是一次补满", () => {
    const spent: Bucket = { tokens: 0, updatedAt: 0 };
    const r = consumeToken(spent, 6_000, CFG); // 过了 6 秒 → 恰好补回 1 个
    expect(r.ok).toBe(true);
    expect(r.bucket.tokens).toBe(0); // 补回来的那 1 个立刻被这次请求花掉
  });

  it("离开很久回来，回补封顶在容量", () => {
    const spent: Bucket = { tokens: 0, updatedAt: 0 };
    // 一小时：线性外推是 600 个，必须封在 10
    const r = consumeToken(spent, 3_600_000, CFG);
    expect(r.ok).toBe(true);
    expect(r.bucket.tokens).toBe(9);
  });

  it("limit = 0 是「不限制」，不是「全拦」", () => {
    // 原始公式下 capacity = 0 → 首次就 tokens < 1 → 永远拒绝，
    // 而且 retryAfterMs = ceil(1 / 0) = Infinity 会漏进 Retry-After 头。
    const cfg: RateLimitConfig = { limit: 0, windowMs: 60_000 };
    for (const t of [0, 1, 2, 100, 3_600_000]) {
      expect(consumeToken(undefined, t, cfg).ok).toBe(true);
    }
  });

  it("windowMs = 0 不能变成「永远放行」——NaN 中毒", () => {
    // refillPerMs = 10 / 0 = Infinity；elapsed 为 0 时 0 * Infinity = NaN，
    // NaN < 1 是 false → 放行，并把 NaN 写进桶，之后每一次都放行。
    const cfg: RateLimitConfig = { limit: 10, windowMs: 0 };
    const r = consumeToken({ tokens: 0, updatedAt: 0 }, 0, cfg);
    expect(r.ok).toBe(true);
    expect(Number.isFinite(r.bucket.tokens)).toBe(true);
  });

  it("时钟回拨：不凭空补令牌，也不让 updatedAt 跟着退回去", () => {
    const before: Bucket = { tokens: 3, updatedAt: 100_000 };
    const r = consumeToken(before, 50_000, CFG); // 时钟往回跳 50 秒
    expect(r.ok).toBe(true);
    expect(r.bucket.tokens).toBe(2); // 只扣掉本次，没有因为"负的 elapsed"补出令牌
    // 若写成 updatedAt = nowMs，后续按真实时间来的调用会从这个更早的戳算 elapsed，
    // 接下来一整个窗口都补不满。
    expect(r.bucket.updatedAt).toBe(100_000);
  });

  it("反复被拒不累积幻影回流", () => {
    // 每 1 秒撞一次。若拒绝时不更新 updatedAt，elapsed 会一直从 t=0 累加，
    // 到第 6 秒就幻影攒够 1 个令牌放行；若拒绝时不存回补后的 tokens，同理。
    let d = deny(consumeToken({ tokens: 0, updatedAt: 0 }, 0, CFG));
    for (const t of [1_000, 2_000, 3_000, 4_000, 5_000]) {
      d = deny(consumeToken(d.bucket, t, CFG));
    }
    // 真实回补只有 5 秒 × (10 / 60000) ≈ 0.833 个，还不够 1 个
    expect(d.bucket.tokens).toBeCloseTo(5_000 * (10 / 60_000), 10);
  });
});

describe("retryAfterSeconds", () => {
  it("向上取整到秒", () => {
    expect(retryAfterSeconds(new RateLimitedError(1_001, 10, 60_000))).toBe(2);
    expect(retryAfterSeconds(new RateLimitedError(20_000, 3, 60_000))).toBe(20);
  });

  it("最小是 1——「0 秒后再试」没有意义", () => {
    expect(retryAfterSeconds(new RateLimitedError(0, 10, 60_000))).toBe(1);
    expect(retryAfterSeconds(new RateLimitedError(1, 10, 60_000))).toBe(1);
  });
});

describe("createRateLimiter", () => {
  /** 3 次/分：容量 3，回流 1 个 / 20 秒。 */
  const cfg3 = () => ({ limit: 3, windowMs: 60_000 });

  it("连续调用超过阈值后抛 RateLimitedError", async () => {
    const rl = createRateLimiter(cfg3);
    for (let i = 0; i < 3; i++) await rl.enforce("u1", 0);
    await expect(rl.enforce("u1", 0)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("抛出来的错带着 Retry-After 需要的秒数", async () => {
    const rl = createRateLimiter(cfg3);
    for (let i = 0; i < 3; i++) await rl.enforce("u1", 0);
    const err = await rl.enforce("u1", 0).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitedError);
    // 3 次 / 60 秒 → 补一个令牌 20 秒
    expect(retryAfterSeconds(err as RateLimitedError)).toBe(20);
  });

  it("不同 userId 互不影响", async () => {
    const rl = createRateLimiter(cfg3);
    for (let i = 0; i < 3; i++) await rl.enforce("u1", 0);
    await expect(rl.enforce("u2", 0)).resolves.toBeUndefined();
  });

  it("空闲超过窗口的桶会被扫掉，size 回落", async () => {
    const rl = createRateLimiter(cfg3);
    await rl.enforce("old", 0);
    expect(rl.size()).toBe(1);
    await rl.enforce("new", 60_001); // 跨过一个窗口，触发 sweep
    expect(rl.size()).toBe(1); // old 被扫掉，只剩刚写进来的 new
  });

  it("配置是每次调用现读的，不是构造时捕获的", async () => {
    // 先"不限制"：连 Map 都不该碰
    let cfg: RateLimitConfig = { limit: 0, windowMs: 60_000 };
    const rl = createRateLimiter(() => cfg);
    for (let i = 0; i < 5; i++) await rl.enforce("u1", 0);
    expect(rl.size()).toBe(0);

    // 模拟 .env 在 import 之后才被加载（脚本的套路，见 rateLimitConfig 注释）
    cfg = { limit: 1, windowMs: 60_000 };
    await rl.enforce("u1", 0);
    await expect(rl.enforce("u1", 0)).rejects.toBeInstanceOf(RateLimitedError);
  });
});

describe("rateLimitConfig", () => {
  const saved = process.env.AI_RATE_LIMIT_PER_MIN;

  afterEach(() => {
    if (saved === undefined) delete process.env.AI_RATE_LIMIT_PER_MIN;
    else process.env.AI_RATE_LIMIT_PER_MIN = saved;
  });

  it("没设就用默认值", () => {
    delete process.env.AI_RATE_LIMIT_PER_MIN;
    expect(rateLimitConfig().limit).toBe(DEFAULT_RATE_LIMIT_PER_MIN);
  });

  it("空串走默认值而不是 0——静默关掉限流是最坏的失败方向", () => {
    // Number("") 是 0，而 0 的含义是"不限制"，所以这里必须显式判空。
    process.env.AI_RATE_LIMIT_PER_MIN = "";
    expect(rateLimitConfig().limit).toBe(DEFAULT_RATE_LIMIT_PER_MIN);
    process.env.AI_RATE_LIMIT_PER_MIN = "   ";
    expect(rateLimitConfig().limit).toBe(DEFAULT_RATE_LIMIT_PER_MIN);
  });

  it("显式的 0 仍然是「不限制」", () => {
    process.env.AI_RATE_LIMIT_PER_MIN = "0";
    expect(rateLimitConfig().limit).toBe(0);
  });

  it("非法值与负数回退到默认值", () => {
    process.env.AI_RATE_LIMIT_PER_MIN = "abc";
    expect(rateLimitConfig().limit).toBe(DEFAULT_RATE_LIMIT_PER_MIN);
    process.env.AI_RATE_LIMIT_PER_MIN = "-5";
    expect(rateLimitConfig().limit).toBe(DEFAULT_RATE_LIMIT_PER_MIN);
  });

  it("窗口固定 60 秒", () => {
    expect(rateLimitConfig().windowMs).toBe(RATE_LIMIT_WINDOW_MS);
  });
});

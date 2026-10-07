/**
 * 每日预算：查当日累计 → 超限就拦。
 *
 * ## 这是「尽力而为」，不是硬限额
 *
 * `enforceBudget` / `canSpend` 都是「读 → 调用 → 写」三步，中间没有任何锁。
 * 而且窗口**不是毫秒级**：一次带重试的 DeepSeek 调用最坏耗时
 * `(retries + 1) × timeoutMs` ≈ 3 分钟（见 deepseekProvider.ts 与 resilience.ts）。
 * 所以一个用户并发发 N 个请求，能超到 **N 倍**，不是超 1 个。
 *
 * SQLite 上普通事务关不掉这个缝：Prisma 的交互式事务不发 `BEGIN IMMEDIATE`，
 * WAL 模式下读也不阻塞写。真要做硬上限得「预留-对账」（先插一条 reserved 行
 * 再统计，超了删掉自己的）。**这里明确不做。** 全局 token 上限是真正的成本兜底，
 * 每用户次数是礼貌性限制。
 *
 * ## DB 出问题时 fail-open
 *
 * 预算查询抛错时**放行**并打日志。预算库抖一下就让全站降级到模板、让问答全变
 * 429，比超支一天更糟。拦截记录的写入失败则**不影响拦截本身** —— 已经查出来超了
 * 就该拦，记账是次要的。
 *
 * ## 测试覆盖到哪
 *
 * `npm test` 覆盖的是纯函数（`decideBudget` / `startOfDay`）和守卫的分支
 * （`BudgetGuardedProvider`）。**本文件的 DB 层（两个聚合查询、`_sum` 的 null 合并、
 * 拦截行的 upsert）不在 `npm test` 里** —— 仓库没有 DB 测试基建，不为两条查询
 * 引入一套。这几条由 `scripts/verify-usage.ts` 对着真库 + 真 API 验，别因为
 * `decideBudget` 测过了就以为这层也被测过。
 */
import { prisma } from "@/lib/db/prisma";
import { logger } from "@/lib/logger";
import { readInt } from "./resilience";
import { resolveMode, type LlmUsage } from "./llm";

/** 预算上限。`0` 表示**不限制**（不是「全拦」）。 */
export interface BudgetLimits {
  callLimit: number;
  tokenLimit: number;
}

export interface BudgetState {
  /** 当日**真实**调用次数（不含被拦下的行）。 */
  calls: number;
  /** 当日**全站** token 和（prompt + completion）。 */
  tokens: number;
}

export type BudgetDecision = { ok: true } | { ok: false; reason: "calls" | "tokens" };

export class BudgetExceededError extends Error {
  readonly reason: "calls" | "tokens";
  readonly used: number;
  readonly limit: number;

  constructor(reason: "calls" | "tokens", used: number, limit: number) {
    super(
      reason === "calls"
        ? `今日 AI 调用次数已达上限（${used}/${limit}）`
        : `今日全站 AI token 用量已达上限（${used}/${limit}）`,
    );
    this.name = "BudgetExceededError";
    this.reason = reason;
    this.used = used;
    this.limit = limit;
  }
}

export const DEFAULT_CALL_LIMIT = 50;
export const DEFAULT_TOKEN_LIMIT = 2_000_000;

/**
 * 判据：`>=` 而不是 `>`。`callLimit = 50` 的含义是「最多 50 次」——
 * 第 50 次调用发生在 `calls = 49` 时（放行），第 51 次发生在 `calls = 50` 时（拦下）。
 * 纯函数，不碰 DB、不读 env。
 */
export function decideBudget(state: BudgetState, limits: BudgetLimits): BudgetDecision {
  // 先判次数：个人维度比全站维度更可能是用户自己的问题，报这个更有指导性。
  if (limits.callLimit > 0 && state.calls >= limits.callLimit) {
    return { ok: false, reason: "calls" };
  }
  if (limits.tokenLimit > 0 && state.tokens >= limits.tokenLimit) {
    return { ok: false, reason: "tokens" };
  }
  return { ok: true };
}

/**
 * 「今天」的起点。
 *
 * `tzOffsetMinutes` **显式传入**而不是读 `process.env.TZ`：那会让开发机（UTC+8）
 * 和生产（UTC）在不同时刻重置额度，也会让任何钉「午夜」的测试在 CI 上飘。
 * 做法是把时刻平移到目标时区，按 UTC 取整到当天 0 点，再平移回来。
 */
export function startOfDay(now: Date, tzOffsetMinutes: number): Date {
  const shiftMs = tzOffsetMinutes * 60_000;
  const shifted = new Date(now.getTime() + shiftMs);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - shiftMs);
}

/**
 * 预算重置用的时区偏移。默认 **UTC**——额度重置不需要对齐用户的一天，
 * 而 UTC 是唯一在开发机和生产上一致的选择。
 */
function budgetTzOffsetMinutes(): number {
  // min 给 -720（UTC-12）：负偏移是合法的，readInt 的默认 min=0 会把它当成非法值静默回退。
  return readInt(process.env.AI_BUDGET_TZ_OFFSET_MIN, 0, -720);
}

/**
 * 当前预算窗口的起点。导出是为了让验证脚本（`scripts/verify-usage.ts`）与
 * `checkBudget` 用**同一个**窗口，否则它自己拼一个 `startOfDay(now, 0)` 会在
 * 有人配了 `AI_BUDGET_TZ_OFFSET_MIN` 之后悄悄量错区间。
 */
export function budgetDayStart(now: Date = new Date()): Date {
  return startOfDay(now, budgetTzOffsetMinutes());
}

/**
 * 懒读 env，不用模块级常量：脚本（`scripts/eval-answer.ts`）是先 import 再
 * `process.loadEnvFile()`，模块级常量会在 .env 加载之前就把值读掉。
 * 同 `deepseekProvider.ts` 的 `baseUrl()`。
 *
 * `min` 传 **0** 而不是 1：`readInt("0", 50, 1)` 会返回 **50**，那样「0 = 不限制」
 * 就永远配不出来（resilience.test.ts 里已固化这个行为）。
 */
export function budgetLimits(): BudgetLimits {
  return {
    callLimit: readInt(process.env.AI_DAILY_CALL_LIMIT, DEFAULT_CALL_LIMIT, 0),
    tokenLimit: readInt(process.env.AI_DAILY_TOKEN_LIMIT, DEFAULT_TOKEN_LIMIT, 0),
  };
}

export interface BudgetCheck {
  decision: BudgetDecision;
  state: BudgetState;
  limits: BudgetLimits;
}

/** 查当日累计并判定。**查询本身失败时抛** —— fail-open 的决定留给调用方。 */
export async function checkBudget(userId: string): Promise<BudgetCheck> {
  const limits = budgetLimits();
  const since = budgetDayStart();

  const [calls, sum] = await Promise.all([
    // 只数真实调用。拦下的行不是一次调用，数进去会让计数虚高、指标失真。
    prisma.llmUsageRecord.count({
      where: { userId, createdAt: { gte: since }, degraded: false },
    }),
    prisma.llmUsageRecord.aggregate({
      _sum: { promptTokens: true, completionTokens: true },
      where: { createdAt: { gte: since } },
    }),
  ]);

  // 当天零记录时 `_sum` 的每一项都是 null。不 coalesce 的话 tokens 会是 null，
  // `null > limit` 恰好在 JS 里是 false（碰巧对），但任何算术和日志都会坏。
  const tokens = (sum._sum.promptTokens ?? 0) + (sum._sum.completionTokens ?? 0);

  const state: BudgetState = { calls, tokens };
  return { decision: decideBudget(state, limits), state, limits };
}

/** 拦截记录按天算 key。`dayKey` 只给被拦的行填，真实行留 NULL（见 schema 注释）。 */
function dayKeyOf(now: Date): string {
  const shifted = new Date(now.getTime() + budgetTzOffsetMinutes() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

/**
 * 记一行「被预算拦下」。**每用户每天最多一行** —— 靠 `(userId, dayKey)` 唯一索引
 * upsert，`blockedCount` 累加。被拦的用户循环重试不会把表写爆（否则 10 req/s
 * 就是每天 86 万行），而「撞了几次墙」本身比一堆重复行有用。
 */
export async function recordBlocked(
  userId: string,
  provider: string,
  model?: string,
): Promise<void> {
  const dayKey = dayKeyOf(new Date());
  await prisma.llmUsageRecord.upsert({
    where: { userId_dayKey: { userId, dayKey } },
    create: {
      userId,
      provider,
      model: model ?? null,
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: 0,
      degraded: true,
      dayKey,
    },
    update: { blockedCount: { increment: 1 } },
  });
}

/** 记一行真实调用。 */
export async function recordUsage(userId: string, u: LlmUsage): Promise<void> {
  await prisma.llmUsageRecord.create({
    data: {
      userId,
      provider: u.provider,
      model: u.model,
      promptTokens: u.promptTokens,
      completionTokens: u.completionTokens,
      latencyMs: u.latencyMs,
    },
  });
}

/**
 * 给 `ChatJsonOptions.onUsage` 用的 sink。**自己吞掉异常** —— 它跑在 provider
 * 内部，抛出去会被 `chatJson` 的 catch 包装成 `[prompt ...]` 错误，让一次 DB
 * 写入失败看起来像 prompt 回归，而且是发生在一次已经成功、已经计费的调用之后。
 *
 * `requestId` 只进日志。记账本身与它无关，但那句"记账失败"必须能归到某次请求上 ——
 * 这正是引入 request ID 要解决的事。
 */
export function usageSink(userId: string, requestId?: string): (u: LlmUsage) => void {
  return (u) => {
    void recordUsage(userId, u).catch((err) =>
      logger.error({ err, requestId }, "[usage] 记账失败"),
    );
  };
}

/**
 * 超了预算就**记一行拦截并抛 `BudgetExceededError`**，否则什么都不做。
 *
 * 名字用 enforce 而不是 assert：它**有副作用**（写 degraded 行），叫 assert
 * 会让人以为它只读，那样就很容易忘记记账。
 */
export async function enforceBudget(userId: string, requestId?: string): Promise<void> {
  let check: BudgetCheck;
  try {
    check = await checkBudget(userId);
  } catch (err) {
    logger.error({ err, requestId }, "[usage] 预算查询失败，本次放行");
    return;
  }
  if (check.decision.ok) return;

  const { reason } = check.decision;
  const used = reason === "calls" ? check.state.calls : check.state.tokens;
  const limit = reason === "calls" ? check.limits.callLimit : check.limits.tokenLimit;

  // 记不上也照样拦：已经查出来超了，记账是次要的。
  await recordBlocked(userId, resolveMode()).catch((err) =>
    logger.error({ err, requestId }, "[usage] 写拦截记录失败"),
  );
  throw new BudgetExceededError(reason, used, limit);
}

/**
 * 给 `BudgetGuardedProvider` 用的判定：还能不能花钱。查询失败时**放行**（fail-open）。
 * 超限时同样记一行拦截。
 */
export async function canSpend(userId: string, requestId?: string): Promise<boolean> {
  try {
    const { decision } = await checkBudget(userId);
    if (decision.ok) return true;
    await recordBlocked(userId, resolveMode()).catch((err) =>
      logger.error({ err, requestId }, "[usage] 写拦截记录失败"),
    );
    return false;
  } catch (err) {
    logger.error({ err, requestId }, "[usage] 预算查询失败，本次放行");
    return true;
  }
}

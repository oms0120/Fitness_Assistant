/**
 * 用量记账 + 预算拦截的**真实验证**（要真 `DEEPSEEK_API_KEY`，会真花钱）。
 *
 *   npx tsx scripts/verify-usage.ts
 *
 * 验三件事，每一件都是「不真跑一次就看不出来」的：
 *
 *   1. **记账准确**：provider 从 API 响应里解析出来的 token 数，与最终落库的行
 *      **逐条相等**。左值是 `onUsage` 回调给的原始 usage，右值是数据库里的行 ——
 *      不是拿数据库跟自己比。
 *   2. **空表的 `_sum` 要合并成 0**：当天零记录时 Prisma 的 `_sum` 返回 `null`，
 *      `null > limit` 恰好在 JS 里是 false（碰巧对），但任何算术都会坏。
 *      只有当天还没有任何记录时才验得到，脚本会说明是否验到了。
 *   3. **拦截只落一行**：超限时 `enforceBudget` 抛 `BudgetExceededError`，且当天
 *      **只有一行** degraded 记录，`blockedCount` 累加（靠 `(userId, dayKey)` 唯一索引）。
 *
 * 副作用：会给 `smoke-test@example.com`（没有则取第一个用户）写几行真实用量。
 * 这是 dev.db，且这些行就是被验的对象。
 */
import fs from "node:fs";

import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { chatJson } from "@/lib/ai/llm";
import type { LlmUsage } from "@/lib/ai/llm";
import {
  BudgetExceededError,
  budgetDayStart,
  checkBudget,
  enforceBudget,
  usageSink,
} from "@/lib/ai/usage";

// 脚本在 Next 之外跑，没人替我们加载 .env（同 scripts/eval-answer.ts）。
for (const file of [".env.local", ".env"]) {
  try {
    if (fs.existsSync(file)) process.loadEnvFile(file);
  } catch {
    /* 已在 shell 里导出 */
  }
}

const CALLS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(`✗ ${message}`);
  console.log(`  ✓ ${message}`);
}

/** 从 API 响应里解析出来的原始 usage，和数据库里的行一一对比。 */
const captured: LlmUsage[] = [];

async function main(): Promise<void> {
  const user =
    (await prisma.user.findUnique({ where: { email: "smoke-test@example.com" } })) ??
    (await prisma.user.findFirst());
  if (!user) throw new Error("dev.db 里一个用户都没有，先注册一个再跑");

  const since = budgetDayStart();
  const rowsTodayBefore = await prisma.llmUsageRecord.count({ where: { createdAt: { gte: since } } });

  // ---- 1. 空表的 _sum ------------------------------------------------------
  console.log("\n[1] 当日累计（_sum 为 null 时必须是 0）");
  const first = await checkBudget(user.id);
  check(
    Number.isFinite(first.state.tokens),
    `tokens 是有限数（${first.state.tokens}），不是 null/NaN`,
  );
  if (rowsTodayBefore === 0) {
    check(first.state.tokens === 0, "今天零记录时合并成 0（这次真的走到了 null 那条分支）");
  } else {
    console.log(`  · 今天已有 ${rowsTodayBefore} 行记录，跳过 null 分支的断言`);
  }

  // ---- 2. 记账准确 ---------------------------------------------------------
  console.log(`\n[2] 记账准确（真调 ${CALLS} 次 DeepSeek）`);
  const before = await prisma.llmUsageRecord.count({
    where: { userId: user.id, degraded: false },
  });

  const opts = (i: number) => ({
    system: '只输出 JSON，形如 {"n": 数字}。',
    user: `计算 ${i} + 1，把结果放进 n。`,
    schema: z.object({ n: z.number() }),
    maxTokens: 200,
    promptVersion: "verify-usage",
  });

  // 走生产路径的 sink（fire-and-forget），所以下面要轮询等它落库。
  const sink = usageSink(user.id);
  for (let i = 0; i < CALLS; i++) {
    const result = await chatJson({
      ...opts(i),
      onUsage: (u) => {
        captured.push(u);
        sink(u);
      },
    });
    const u = captured[captured.length - 1];
    console.log(
      `  · 第 ${i + 1} 次 ${JSON.stringify(result)} → ` +
        `${u.promptTokens}p + ${u.completionTokens}c, ${u.latencyMs}ms, ${u.provider}/${u.model}`,
    );
  }

  // fire-and-forget 的写入是异步的，等它落地本身就是一条要验的性质。
  const deadline = Date.now() + 10_000;
  let count = before;
  while (count < before + CALLS && Date.now() < deadline) {
    await sleep(100);
    count = await prisma.llmUsageRecord.count({ where: { userId: user.id, degraded: false } });
  }
  check(count >= before + CALLS, `${CALLS} 行记账在 10 s 内落库`);

  const rows = await prisma.llmUsageRecord.findMany({
    where: { userId: user.id, degraded: false },
    orderBy: { createdAt: "asc" },
    skip: before,
    take: CALLS,
  });

  check(rows.length === CALLS, "读回的条数与调用次数一致");
  for (let i = 0; i < CALLS; i++) {
    const u = captured[i];
    const r = rows[i];
    check(
      r.promptTokens === u.promptTokens && r.completionTokens === u.completionTokens,
      `第 ${i + 1} 行 token 与响应一致（${r.promptTokens}p + ${r.completionTokens}c）`,
    );
    check(r.provider === u.provider && r.model === u.model, `第 ${i + 1} 行 provider/model 一致（${r.provider}/${r.model}）`);
    check(r.latencyMs === u.latencyMs, `第 ${i + 1} 行 latencyMs 一致（${r.latencyMs}ms）`);
    check(r.degraded === false, `第 ${i + 1} 行不是占位行`);
  }

  // ---- 3. 预算拦截 ---------------------------------------------------------
  console.log("\n[3] 预算拦截");
  const { state } = await checkBudget(user.id);
  console.log(`  · 今天已用 ${state.calls} 次 / 全站 ${state.tokens} token`);

  if (state.calls === 0) {
    console.log("  · 当日计数为 0，而 0 表示「不限制」，没法构造出拦截，跳过本节");
    return;
  }

  const blockedBefore = await prisma.llmUsageRecord.findFirst({
    where: { userId: user.id, degraded: true },
    orderBy: { createdAt: "desc" },
  });

  const savedCall = process.env.AI_DAILY_CALL_LIMIT;
  const savedToken = process.env.AI_DAILY_TOKEN_LIMIT;
  // 上限设成「已经用掉的次数」→ 下一次必定 `calls >= limit`。
  // 只关掉 token 维度，隔离出次数的效果。
  process.env.AI_DAILY_CALL_LIMIT = String(state.calls);
  process.env.AI_DAILY_TOKEN_LIMIT = "0";

  try {
    for (let i = 0; i < 2; i++) {
      let threw = false;
      try {
        await enforceBudget(user.id);
      } catch (e) {
        threw = e instanceof BudgetExceededError;
        if (!threw) throw e;
      }
      check(threw, `第 ${i + 1} 次 enforceBudget 抛了 BudgetExceededError`);
    }
  } finally {
    if (savedCall === undefined) delete process.env.AI_DAILY_CALL_LIMIT;
    else process.env.AI_DAILY_CALL_LIMIT = savedCall;
    if (savedToken === undefined) delete process.env.AI_DAILY_TOKEN_LIMIT;
    else process.env.AI_DAILY_TOKEN_LIMIT = savedToken;
  }

  const blockedRows = await prisma.llmUsageRecord.findMany({
    where: { userId: user.id, degraded: true },
  });
  check(blockedRows.length === 1, "当天只有一行拦截记录（唯一索引封顶，重试不会把表写爆）");

  const expected = (blockedBefore?.blockedCount ?? 0) + 2;
  check(
    blockedRows[0].blockedCount === expected,
    `blockedCount 累加到 ${expected}（撞了两次墙）`,
  );
  check(
    blockedRows[0].promptTokens === 0 && blockedRows[0].completionTokens === 0,
    "占位行的 token 是 0 —— 它不代表一次调用",
  );
  check(
    (await checkBudget(user.id)).state.calls === state.calls,
    "被拦的行没有算进当日次数（否则用户被拦一次就少一个名额）",
  );
}

main()
  .then(() => console.log("\n全部通过。"))
  .catch((err) => {
    console.error("\n失败：", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

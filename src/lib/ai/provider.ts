import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { RuleProvider } from "./ruleProvider";
import { LlmProvider } from "./llmProvider";
import { BudgetGuardedProvider } from "./guardedProvider";
import { resolveMode } from "./llm";
import { canSpend, usageSink } from "./usage";
import { logger } from "@/lib/logger";

export interface AiProvider {
  recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]>;
  generatePlan(input: PlanRequest): Promise<PlanSuggestion>;
  /**
   * 这次结果是不是「超预算降级」来的。只有包了 `BudgetGuardedProvider` 的实现会设它 ——
   * `rule` 模式是主动选的模式，不算降级。
   */
  readonly degraded?: boolean;
}

/**
 * 配了大模型 key 就走模型，否则回退本地规则库。具体走哪家由 llm.ts 决定。
 *
 * `userId` 传了才接预算与记账。**评测脚本没有用户**（`scripts/eval-answer.ts`），
 * 不传时既不查预算也不记账 —— 跑 110 条不该吃掉额度，也不该往 usage 表里写行。
 *
 * `requestId` 只影响日志。传进来是为了让 `usageSink` 与 `canSpend` 里那几条
 * 日志也挂上同一个号 —— 它俩是异步的，没有它就只能靠时间戳猜是哪次请求。
 */
export function getProvider(userId?: string, requestId?: string): AiProvider {
  const mode = resolveMode();

  // `resolveMode()` 的**静默**降级：`AI_PROVIDER` 明确指定了某一家，但对应的 key 没配
  // （或只有空白，见 llm.ts 的 trim），于是落回规则库。用户以为在用模型、其实一直吃模板 ——
  // 除了这行日志没有任何地方看得出来。认不出的取值（如 "gpt"）也走这里。
  //
  // 只在**降级**时打：「一个 key 都没配」是评测和 CI 的正常状态，不是故障，
  // 那种情况也打日志只会把真正的降级淹掉。
  //
  // 判断写在这里而不是 `resolveMode()` 内部：那是个纯函数，每个请求会被调多次
  // （`usage.ts` 的 `recordBlocked` 也调它），塞进去会重复打点，而且它拿不到 requestId。
  // 这里是一次请求一次，粒度正好。
  const requested = process.env.AI_PROVIDER;
  if (requested && requested !== "rule" && mode === "rule") {
    logger.warn({ requestId, requested }, "[ai] AI_PROVIDER 指定的后端无法生效，已降级到规则库");
  }

  if (mode === "rule") return new RuleProvider();
  if (!userId) return new LlmProvider(undefined, requestId);

  return new BudgetGuardedProvider(
    new LlmProvider(usageSink(userId, requestId), requestId),
    new RuleProvider(),
    () => canSpend(userId, requestId),
    requestId,
  );
}

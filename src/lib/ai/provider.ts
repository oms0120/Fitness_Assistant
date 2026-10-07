import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { RuleProvider } from "./ruleProvider";
import { LlmProvider } from "./llmProvider";
import { BudgetGuardedProvider } from "./guardedProvider";
import { resolveMode } from "./llm";
import { canSpend, usageSink } from "./usage";

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
  if (resolveMode() === "rule") return new RuleProvider();
  if (!userId) return new LlmProvider(undefined, requestId);

  return new BudgetGuardedProvider(
    new LlmProvider(usageSink(userId, requestId), requestId),
    new RuleProvider(),
    () => canSpend(userId, requestId),
  );
}

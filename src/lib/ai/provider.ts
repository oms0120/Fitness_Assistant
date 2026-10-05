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
 */
export function getProvider(userId?: string): AiProvider {
  if (resolveMode() === "rule") return new RuleProvider();
  if (!userId) return new LlmProvider();

  return new BudgetGuardedProvider(
    new LlmProvider(usageSink(userId)),
    new RuleProvider(),
    () => canSpend(userId),
  );
}

import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { RuleProvider } from "./ruleProvider";
import { LlmProvider } from "./llmProvider";
import { resolveMode } from "./llm";

export interface AiProvider {
  recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]>;
  generatePlan(input: PlanRequest): Promise<PlanSuggestion>;
}

/** 配了大模型 key 就走模型，否则回退本地规则库。具体走哪家由 llm.ts 决定。 */
export function getProvider(): AiProvider {
  return resolveMode() === "rule" ? new RuleProvider() : new LlmProvider();
}

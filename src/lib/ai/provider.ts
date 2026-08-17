import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { RuleProvider } from "./ruleProvider";
import { ClaudeProvider } from "./claudeProvider";

export interface AiProvider {
  recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]>;
  generatePlan(input: PlanRequest): Promise<PlanSuggestion>;
}

export function getProvider(): AiProvider {
  const mode = process.env.AI_PROVIDER;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (mode === "claude" && hasKey) return new ClaudeProvider();
  return new RuleProvider();
}

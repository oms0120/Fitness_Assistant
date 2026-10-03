import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { recipeSuggestionsSchema, planSuggestionSchema } from "./types";
import type { AiProvider } from "./provider";
import { chatJson } from "./llm";
import {
  PLAN_PROMPT_VERSION,
  RECIPE_PROMPT_VERSION,
  planSystemPrompt,
  recipeSystemPrompt,
} from "./prompts";

/**
 * 走大模型的能力实现。prompt 一律取自 prompts.ts，
 * DeepSeek / Claude 的差异都收在 llm.ts 的后端里。
 */
export class LlmProvider implements AiProvider {
  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    const result = await chatJson({
      system: recipeSystemPrompt(),
      user: JSON.stringify(input),
      schema: recipeSuggestionsSchema,
      promptVersion: RECIPE_PROMPT_VERSION,
    });
    return result.suggestions;
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    return chatJson({
      system: planSystemPrompt(),
      user: JSON.stringify(input),
      schema: planSuggestionSchema,
      promptVersion: PLAN_PROMPT_VERSION,
    });
  }
}

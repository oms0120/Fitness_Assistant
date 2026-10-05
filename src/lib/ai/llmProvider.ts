import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { recipeSuggestionsSchema, planSuggestionSchema } from "./types";
import type { AiProvider } from "./provider";
import { chatJson, type LlmUsage } from "./llm";
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
  /**
   * `sink` 由 `getProvider()` 注入，用来把用量记到 `LlmUsageRecord`。
   *
   * 收**函数**而不是 `userId`：这样这个类完全不碰数据库，可以脱离 DB 单测。
   * 不传就是不记账 —— 评测脚本（`scripts/eval-answer.ts`）没有用户，不该吃额度，
   * 也不该往 usage 表里写行。
   */
  constructor(private readonly sink?: (u: LlmUsage) => void) {}

  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    const result = await chatJson({
      system: recipeSystemPrompt(),
      user: JSON.stringify(input),
      schema: recipeSuggestionsSchema,
      promptVersion: RECIPE_PROMPT_VERSION,
      onUsage: this.sink,
    });
    return result.suggestions;
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    return chatJson({
      system: planSystemPrompt(),
      user: JSON.stringify(input),
      schema: planSuggestionSchema,
      promptVersion: PLAN_PROMPT_VERSION,
      onUsage: this.sink,
    });
  }
}

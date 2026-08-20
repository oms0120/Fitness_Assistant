import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { recipeSuggestionsSchema, planSuggestionSchema } from "./types";
import type { AiProvider } from "./provider";
import { chatJson } from "./llm";

/**
 * 走大模型的能力实现。prompt 与具体厂商无关，
 * DeepSeek / Claude 的差异都收在 llm.ts 的后端里。
 */
export class LlmProvider implements AiProvider {
  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    const result = await chatJson({
      system:
        "你是注册营养师，根据用户的热量与宏量目标推荐中式家常菜谱，热量和宏量尽量贴近目标。",
      user: JSON.stringify(input),
      schema: recipeSuggestionsSchema,
    });
    return result.suggestions;
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    return chatJson({
      system: "你是健身教练，根据部位、水平、器械生成训练计划。",
      user: JSON.stringify(input),
      schema: planSuggestionSchema,
    });
  }
}

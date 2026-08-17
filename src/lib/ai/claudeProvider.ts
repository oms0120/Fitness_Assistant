import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { recipeSuggestionsSchema, planSuggestionSchema } from "./types";

const client = new Anthropic(); // 从 ANTHROPIC_API_KEY 环境变量读

export class ClaudeProvider {
  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: "你是注册营养师，根据用户的热量与宏量目标推荐中式家常菜谱，热量和宏量尽量贴近目标。输出 JSON。",
      messages: [{ role: "user", content: JSON.stringify(input) }],
      output_config: { format: zodOutputFormat(recipeSuggestionsSchema) },
    });
    return response.parsed_output?.suggestions ?? [];
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: "你是健身教练，根据部位、水平、器械生成训练计划。输出 JSON。",
      messages: [{ role: "user", content: JSON.stringify(input) }],
      output_config: { format: zodOutputFormat(planSuggestionSchema) },
    });
    if (!response.parsed_output) {
      throw new Error("AI 训练计划生成失败");
    }
    return response.parsed_output;
  }
}

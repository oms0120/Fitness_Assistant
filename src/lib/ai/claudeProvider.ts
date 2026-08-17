import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";

// 任务 3 将实现真实 Claude 调用；此处为临时占位，仅让 AiProvider 接口可编译。
export class ClaudeProvider {
  async recommendRecipes(_input: RecipeRequest): Promise<RecipeSuggestion[]> {
    throw new Error("ClaudeProvider 尚未实现");
  }

  async generatePlan(_input: PlanRequest): Promise<PlanSuggestion> {
    throw new Error("ClaudeProvider 尚未实现");
  }
}

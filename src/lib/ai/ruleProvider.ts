import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { recipes } from "@/lib/data/recipes";
import { planTemplates } from "@/lib/data/plans";
import { exercises } from "@/lib/data/exercises";
import { findMealPlan } from "@/lib/mealPlanMatching";
import type { AiProvider } from "./provider";

export class RuleProvider implements AiProvider {
  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    // 复用组合配餐算法找最优 3 餐，转成建议
    const plan = findMealPlan({
      targetCalories: input.targetCalories,
      carbRatio: input.carbRatio,
      proteinRatio: input.proteinRatio,
      fatRatio: input.fatRatio,
    });
    if (!plan) return [];
    const toSuggestion = (r: (typeof recipes)[number]): RecipeSuggestion => ({
      name: r.name,
      calories: r.calories,
      proteinG: r.proteinG,
      carbsG: r.carbsG,
      fatG: r.fatG,
      ingredients: r.ingredients,
      steps: r.steps,
      reason: "按你的热量与宏量目标匹配",
    });
    return [plan.breakfast, plan.lunch, plan.dinner].map(toSuggestion);
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    const template = planTemplates.find((t) => t.muscleGroup === input.muscleGroup) ?? planTemplates[0];
    const exerciseById = new Map(exercises.map((e) => [e.id, e]));
    return {
      name: template.name,
      goal: `${input.muscleGroup} 训练`,
      exercises: template.exercises.map((pe) => ({
        name: exerciseById.get(pe.exerciseId)?.name ?? pe.exerciseId,
        sets: pe.sets,
        reps: pe.reps,
      })),
    };
  }
}

import type { Recipe } from "./data/types";
import { recipes } from "./data/recipes";

export interface MacroRatios {
  carbRatio: number;
  proteinRatio: number;
  fatRatio: number;
}

export interface MealPlanResult {
  breakfast: Recipe;
  lunch: Recipe;
  dinner: Recipe;
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number };
  score: number;
}

export function deriveTargetMacros(targetCalories: number, ratios: MacroRatios) {
  return {
    calories: targetCalories,
    proteinG: (targetCalories * ratios.proteinRatio) / 4,
    carbsG: (targetCalories * ratios.carbRatio) / 4,
    fatG: (targetCalories * ratios.fatRatio) / 9,
  };
}

export function findMealPlan(input: { targetCalories: number } & MacroRatios): MealPlanResult | null {
  const targets = deriveTargetMacros(input.targetCalories, {
    carbRatio: input.carbRatio,
    proteinRatio: input.proteinRatio,
    fatRatio: input.fatRatio,
  });

  const breakfasts = recipes.filter((r) => r.mealType === "breakfast");
  const meals = recipes.filter((r) => r.mealType === "meal");

  let best: MealPlanResult | null = null;
  let bestScore = Infinity;

  for (const breakfast of breakfasts) {
    for (const lunch of meals) {
      for (const dinner of meals) {
        const totals = {
          calories: breakfast.calories + lunch.calories + dinner.calories,
          proteinG: breakfast.proteinG + lunch.proteinG + dinner.proteinG,
          carbsG: breakfast.carbsG + lunch.carbsG + dinner.carbsG,
          fatG: breakfast.fatG + lunch.fatG + dinner.fatG,
        };
        const score =
          Math.abs(totals.calories - targets.calories) / targets.calories +
          Math.abs(totals.proteinG - targets.proteinG) / targets.proteinG +
          Math.abs(totals.carbsG - targets.carbsG) / targets.carbsG +
          Math.abs(totals.fatG - targets.fatG) / targets.fatG;
        if (score < bestScore) {
          bestScore = score;
          best = { breakfast, lunch, dinner, totals, targets, score };
        }
      }
    }
  }
  return best;
}

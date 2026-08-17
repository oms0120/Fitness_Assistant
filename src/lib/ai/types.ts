import { z } from "zod";

export interface RecipeRequest {
  targetCalories: number;
  proteinRatio: number;
  carbRatio: number;
  fatRatio: number;
  goal: "cut" | "bulk" | "maintain";
}

export interface PlanRequest {
  muscleGroup: string;
  level: "beginner" | "intermediate" | "advanced";
  equipment: string;
}

export const recipeSuggestionSchema = z.object({
  name: z.string(),
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  reason: z.string(),
});
export type RecipeSuggestion = z.infer<typeof recipeSuggestionSchema>;

export const recipeSuggestionsSchema = z.object({
  suggestions: z.array(recipeSuggestionSchema),
});

export const planExerciseSchema = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.number(),
});
export const planSuggestionSchema = z.object({
  name: z.string(),
  goal: z.string(),
  exercises: z.array(planExerciseSchema),
});
export type PlanSuggestion = z.infer<typeof planSuggestionSchema>;

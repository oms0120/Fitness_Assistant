import type { Exercise, MuscleGroup, Recipe } from "./data/types";
import { recipes } from "./data/recipes";
import { exercises } from "./data/exercises";

export function matchRecipesByCalories(targetKcal: number, tolerance = 0.1): Recipe[] {
  const lo = targetKcal * (1 - tolerance);
  const hi = targetKcal * (1 + tolerance);
  const inRange = recipes.filter((r) => r.calories >= lo && r.calories <= hi);
  const sorted = [...inRange].sort((a, b) => Math.abs(a.calories - targetKcal) - Math.abs(b.calories - targetKcal));
  if (sorted.length > 0) return sorted;
  // 无匹配：返回最接近的 1 个
  const closest = [...recipes].sort((a, b) => Math.abs(a.calories - targetKcal) - Math.abs(b.calories - targetKcal));
  return closest.slice(0, 1);
}

export function filterExercisesByGroup(group: MuscleGroup): Exercise[] {
  return exercises.filter((e) => e.muscleGroup === group);
}

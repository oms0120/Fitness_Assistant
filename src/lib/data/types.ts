export type MuscleGroup = "chest" | "shoulder" | "back" | "legs" | "arms";

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  instructions: string;
}

export interface Recipe {
  id: string;
  name: string;
  category: "cut" | "bulk" | "balanced";
  mealType: "breakfast" | "meal";
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  ingredients: string[];
  steps: string[];
  tags: string[];
}

export interface PlanExercise {
  exerciseId: string;
  sets: number;
  reps: number;
}

export interface PlanDay {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  exercises: PlanExercise[];
}

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: "胸",
  shoulder: "肩",
  back: "背",
  legs: "腿",
  arms: "臂",
};

export const DIFFICULTY_LABELS: Record<Exercise["difficulty"], string> = {
  beginner: "入门",
  intermediate: "中级",
  advanced: "高级",
};

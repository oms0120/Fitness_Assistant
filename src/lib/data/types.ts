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

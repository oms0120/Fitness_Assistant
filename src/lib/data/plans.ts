import type { PlanDay } from "./types";

export const planTemplates: PlanDay[] = [
  { id: "chest-day", name: "胸日", muscleGroup: "chest", exercises: [
    { exerciseId: "barbell-bench-press", sets: 4, reps: 10 },
    { exerciseId: "incline-dumbbell-press", sets: 3, reps: 10 },
    { exerciseId: "dumbbell-fly", sets: 3, reps: 12 },
    { exerciseId: "push-up", sets: 3, reps: 15 },
  ]},
  { id: "shoulder-day", name: "肩日", muscleGroup: "shoulder", exercises: [
    { exerciseId: "seated-dumbbell-press", sets: 4, reps: 10 },
    { exerciseId: "dumbbell-lateral-raise", sets: 3, reps: 15 },
    { exerciseId: "reverse-fly", sets: 3, reps: 15 },
    { exerciseId: "overhead-press", sets: 3, reps: 8 },
  ]},
  { id: "back-day", name: "背日", muscleGroup: "back", exercises: [
    { exerciseId: "pull-up", sets: 4, reps: 8 },
    { exerciseId: "barbell-row", sets: 3, reps: 10 },
    { exerciseId: "lat-pulldown", sets: 3, reps: 12 },
    { exerciseId: "seated-cable-row", sets: 3, reps: 12 },
  ]},
  { id: "legs-day", name: "腿日", muscleGroup: "legs", exercises: [
    { exerciseId: "barbell-squat", sets: 4, reps: 8 },
    { exerciseId: "deadlift", sets: 3, reps: 6 },
    { exerciseId: "leg-press", sets: 3, reps: 12 },
    { exerciseId: "lunge", sets: 3, reps: 12 },
  ]},
  { id: "arms-day", name: "臂日", muscleGroup: "arms", exercises: [
    { exerciseId: "barbell-curl", sets: 4, reps: 10 },
    { exerciseId: "hammer-curl", sets: 3, reps: 12 },
    { exerciseId: "cable-pushdown", sets: 3, reps: 12 },
    { exerciseId: "close-grip-bench-press", sets: 3, reps: 10 },
  ]},
];

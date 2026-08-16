import { z } from "zod";
import { parseResult } from "./result";
import { Goal, MACRO_DEFAULTS } from "./types";

export const macrosInputSchema = z.object({
  tdee: z.number().positive("TDEE 需为正数"),
  weightKg: z.number().min(30).max(300),
  goal: z.nativeEnum(Goal, { message: "请选择目标" }),
  overrides: z
    .object({
      calorieFactor: z.number().min(0.5).max(1.5).optional(),
      proteinPerKg: z.number().min(0.8).max(3.5).optional(),
      fatRatio: z.number().min(0.15).max(0.4).optional(),
    })
    .optional(),
});

export type MacrosInput = z.infer<typeof macrosInputSchema>;
export interface MacrosOutput {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export function calculateMacros(input: unknown) {
  const parsed = parseResult(macrosInputSchema, input);
  if (!parsed.ok) return parsed;
  const { tdee, weightKg, goal, overrides } = parsed.data;

  const calorieFactor = overrides?.calorieFactor ?? MACRO_DEFAULTS.calorieFactor[goal];
  const proteinPerKg = overrides?.proteinPerKg ?? MACRO_DEFAULTS.proteinPerKg[goal];
  const fatRatio = overrides?.fatRatio ?? MACRO_DEFAULTS.fatRatio;

  const calories = tdee * calorieFactor;
  const proteinG = proteinPerKg * weightKg;
  const proteinKcal = proteinG * 4;
  const fatKcal = calories * fatRatio;
  const fatG = fatKcal / 9;
  const carbsG = Math.max(0, (calories - proteinKcal - fatKcal) / 4);

  return { ok: true, data: { calories, proteinG, fatG, carbsG } } as const;
}

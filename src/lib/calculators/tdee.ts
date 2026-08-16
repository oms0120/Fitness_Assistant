import { z } from "zod";
import { parseResult } from "./result";
import { ActivityLevel, ACTIVITY_FACTORS } from "./types";

export const tdeeInputSchema = z.object({
  bmr: z.number().positive("BMR 需为正数"),
  activityLevel: z.nativeEnum(ActivityLevel, { message: "请选择活动水平" }),
});

export type TdeeInput = z.infer<typeof tdeeInputSchema>;
export interface TdeeOutput {
  tdee: number;
  activityFactor: number;
}

export function calculateTdee(input: unknown) {
  const parsed = parseResult(tdeeInputSchema, input);
  if (!parsed.ok) return parsed;
  const { bmr, activityLevel } = parsed.data;
  const activityFactor = ACTIVITY_FACTORS[activityLevel];
  const tdee = bmr * activityFactor;
  return { ok: true, data: { tdee, activityFactor } } as const;
}

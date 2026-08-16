import { z } from "zod";
import { parseResult } from "./result";

export const ffmiInputSchema = z.object({
  weightKg: z.number().min(30).max(300),
  heightCm: z.number().min(100).max(250),
  bodyFatPct: z.number().min(2).max(60, "体脂率需在 2-60%"),
});

export type FfmiInput = z.infer<typeof ffmiInputSchema>;
export interface FfmiOutput {
  leanMassKg: number;
  ffmi: number;
  adjustedFfmi: number;
}

export function calculateFfmi(input: unknown) {
  const parsed = parseResult(ffmiInputSchema, input);
  if (!parsed.ok) return parsed;
  const { weightKg, heightCm, bodyFatPct } = parsed.data;

  const heightM = heightCm / 100;
  const leanMassKg = weightKg * (1 - bodyFatPct / 100);
  const ffmi = leanMassKg / (heightM * heightM);
  const adjustedFfmi = ffmi + 6.1 * (1.8 - heightM);

  return { ok: true, data: { leanMassKg, ffmi, adjustedFfmi } } as const;
}

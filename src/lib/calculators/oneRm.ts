import { z } from "zod";
import { parseResult } from "./result";

export const oneRmInputSchema = z.object({
  weightKg: z.number().min(1, "重量需 > 0").max(1000, "重量需 ≤ 1000"),
  reps: z.number().int().min(1, "次数需 ≥ 1").max(30, "次数需 ≤ 30"),
});

export type OneRmInput = z.infer<typeof oneRmInputSchema>;
export interface OneRmOutput {
  epley: number;
  brzycki: number;
}

export function calculateOneRm(input: unknown) {
  const parsed = parseResult(oneRmInputSchema, input);
  if (!parsed.ok) return parsed;
  const { weightKg, reps } = parsed.data;

  const epley = weightKg * (1 + reps / 30);
  const brzycki = (weightKg * 36) / (37 - reps);

  return { ok: true, data: { epley, brzycki } } as const;
}

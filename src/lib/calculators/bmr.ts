import { z } from "zod";
import { parseResult } from "./result";

export const bmrInputSchema = z.object({
  sex: z.enum(["male", "female"], { message: "请选择性别" }),
  weightKg: z.number().min(30, "体重需 ≥ 30kg").max(300, "体重需 ≤ 300kg"),
  heightCm: z.number().min(100, "身高需 ≥ 100cm").max(250, "身高需 ≤ 250cm"),
  age: z.number().int().min(10, "年龄需 ≥ 10").max(100, "年龄需 ≤ 100"),
});

export type BmrInput = z.infer<typeof bmrInputSchema>;
export interface BmrOutput {
  bmr: number;
}

export function calculateBmr(input: unknown) {
  const parsed = parseResult(bmrInputSchema, input);
  if (!parsed.ok) return parsed;
  const { sex, weightKg, heightCm, age } = parsed.data;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = sex === "male" ? base + 5 : base - 161;
  return { ok: true, data: { bmr } } as const;
}

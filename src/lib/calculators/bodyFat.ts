import { z } from "zod";
import { parseResult } from "./result";

export const bodyFatInputSchema = z
  .object({
    sex: z.enum(["male", "female"], { message: "请选择性别" }),
    heightCm: z.number().min(100, "身高需 ≥ 100cm").max(250, "身高需 ≤ 250cm"),
    neckCm: z.number().min(20, "围度需 ≥ 20cm").max(120, "围度需 ≤ 120cm"),
    waistCm: z.number().min(20, "围度需 ≥ 20cm").max(120, "围度需 ≤ 120cm"),
    hipCm: z.number().min(20, "围度需 ≥ 20cm").max(120, "围度需 ≤ 120cm").optional(),
  })
  .superRefine((v, ctx) => {
    if (v.sex === "male") {
      if (v.waistCm <= v.neckCm) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["waistCm"], message: "腰围需大于颈围" });
      }
    } else {
      if (!v.hipCm) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hipCm"], message: "女性需填写臀围" });
      } else if (v.waistCm + v.hipCm <= v.neckCm) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["waistCm"], message: "腰围+臀围需大于颈围" });
      }
    }
  });

export type BodyFatInput = z.infer<typeof bodyFatInputSchema>;
export interface BodyFatOutput {
  bodyFatPct: number;
}

export function calculateBodyFat(input: unknown) {
  const parsed = parseResult(bodyFatInputSchema, input);
  if (!parsed.ok) return parsed;
  const { sex, heightCm, neckCm, waistCm, hipCm } = parsed.data;

  const log10 = (n: number) => Math.log10(n);
  let bodyFatPct: number;
  if (sex === "male") {
    const denom = 1.0324 - 0.19077 * log10(waistCm - neckCm) + 0.15456 * log10(heightCm);
    bodyFatPct = 495 / denom - 450;
  } else {
    const denom = 1.29579 - 0.35004 * log10(waistCm + hipCm! - neckCm) + 0.221 * log10(heightCm);
    bodyFatPct = 495 / denom - 450;
  }
  return { ok: true, data: { bodyFatPct } } as const;
}

import { describe, it, expect } from "vitest";
import { calculateBodyFat } from "@/lib/calculators/bodyFat";

describe("bodyFat (Navy Method)", () => {
  it("男", () => {
    const r = calculateBodyFat({ sex: "male", heightCm: 170, neckCm: 40, waistCm: 80 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bodyFatPct).toBeCloseTo(11.96, 2);
  });
  it("女", () => {
    const r = calculateBodyFat({ sex: "female", heightCm: 160, neckCm: 34, waistCm: 70, hipCm: 95 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bodyFatPct).toBeCloseTo(25.17, 1);
  });
  it("腰围不大于颈围（男）返回错误", () => {
    const r = calculateBodyFat({ sex: "male", heightCm: 170, neckCm: 90, waistCm: 80 });
    expect(r.ok).toBe(false);
  });
});

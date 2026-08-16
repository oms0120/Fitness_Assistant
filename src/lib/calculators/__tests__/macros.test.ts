import { describe, it, expect } from "vitest";
import { calculateMacros } from "@/lib/calculators/macros";

describe("macros", () => {
  it("减脂", () => {
    const r = calculateMacros({ tdee: 2500, weightKg: 70, goal: "cut" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.calories).toBeCloseTo(2000, 2);
      expect(r.data.proteinG).toBeCloseTo(154, 2);
      expect(r.data.fatG).toBeCloseTo(55.56, 2);
      expect(r.data.carbsG).toBeCloseTo(221, 2);
    }
  });
  it("增肌", () => {
    const r = calculateMacros({ tdee: 2500, weightKg: 70, goal: "bulk" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.calories).toBeCloseTo(2750, 2);
      expect(r.data.proteinG).toBeCloseTo(126, 2);
      expect(r.data.fatG).toBeCloseTo(76.39, 2);
      expect(r.data.carbsG).toBeCloseTo(389.63, 2);
    }
  });
  it("维持", () => {
    const r = calculateMacros({ tdee: 2500, weightKg: 70, goal: "maintain" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.calories).toBeCloseTo(2500, 2);
      expect(r.data.proteinG).toBeCloseTo(126, 2);
      expect(r.data.fatG).toBeCloseTo(69.44, 2);
      expect(r.data.carbsG).toBeCloseTo(342.75, 2);
    }
  });
  it("高级设置覆盖", () => {
    const r = calculateMacros({ tdee: 2500, weightKg: 70, goal: "cut", overrides: { calorieFactor: 0.9 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.calories).toBeCloseTo(2250, 2);
  });
});

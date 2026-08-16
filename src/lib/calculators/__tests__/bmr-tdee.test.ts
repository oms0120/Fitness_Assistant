import { describe, it, expect } from "vitest";
import { calculateBmr } from "@/lib/calculators/bmr";
import { calculateTdee } from "@/lib/calculators/tdee";
import { ActivityLevel } from "@/lib/calculators/types";

describe("BMR (Mifflin-St Jeor)", () => {
  it("男", () => {
    const r = calculateBmr({ sex: "male", weightKg: 70, heightCm: 175, age: 25 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bmr).toBeCloseTo(1673.75, 2);
  });
  it("女", () => {
    const r = calculateBmr({ sex: "female", weightKg: 60, heightCm: 165, age: 25 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bmr).toBeCloseTo(1345.25, 2);
  });
  it("非法输入返回错误", () => {
    const r = calculateBmr({ sex: "male", weightKg: 0, heightCm: 175, age: 25 });
    expect(r.ok).toBe(false);
  });
});

describe("TDEE", () => {
  it("中度活动", () => {
    const r = calculateTdee({ bmr: 1673.75, activityLevel: ActivityLevel.MODERATE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.tdee).toBeCloseTo(2594.31, 2);
  });
});

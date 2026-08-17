import { describe, it, expect } from "vitest";
import { findMealPlan, deriveTargetMacros } from "@/lib/mealPlanMatching";

describe("deriveTargetMacros", () => {
  it("按比例推导宏量", () => {
    const m = deriveTargetMacros(2000, { carbRatio: 0.4, proteinRatio: 0.4, fatRatio: 0.2 });
    expect(m.proteinG).toBeCloseTo(200, 2);  // 2000*0.4/4
    expect(m.carbsG).toBeCloseTo(200, 2);    // 2000*0.4/4
    expect(m.fatG).toBeCloseTo(44.44, 2);    // 2000*0.2/9
  });
});

describe("findMealPlan", () => {
  it("返回早/午/晚 3 餐，早餐是 breakfast 类", () => {
    const result = findMealPlan({ targetCalories: 1500, carbRatio: 0.4, proteinRatio: 0.4, fatRatio: 0.2 });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.breakfast.mealType).toBe("breakfast");
      expect(result.lunch.mealType).toBe("meal");
      expect(result.dinner.mealType).toBe("meal");
      // totals 正确
      expect(result.totals.calories).toBeCloseTo(result.breakfast.calories + result.lunch.calories + result.dinner.calories, 2);
      expect(result.totals.proteinG).toBeCloseTo(result.breakfast.proteinG + result.lunch.proteinG + result.dinner.proteinG, 2);
    }
  });
  it("宏量比例极端时仍能返回结果", () => {
    const result = findMealPlan({ targetCalories: 3000, carbRatio: 0.6, proteinRatio: 0.3, fatRatio: 0.1 });
    expect(result).not.toBeNull();
  });
});

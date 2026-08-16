import { describe, it, expect } from "vitest";
import { matchRecipesByCalories, filterExercisesByGroup } from "@/lib/mealMatching";

describe("matchRecipesByCalories", () => {
  it("返回热量在 ±10% 内的菜谱，按差值升序", () => {
    const result = matchRecipesByCalories(300, 0.1);
    expect(result.length).toBeGreaterThan(0);
    // 每个结果都在 270-330 范围内
    for (const r of result) {
      expect(r.calories).toBeGreaterThanOrEqual(270);
      expect(r.calories).toBeLessThanOrEqual(330);
    }
    // 按差值升序
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i].calories - 300)).toBeGreaterThanOrEqual(Math.abs(result[i - 1].calories - 300));
    }
  });
  it("无匹配时返回最接近的 1 个", () => {
    const result = matchRecipesByCalories(9999, 0.1);
    expect(result.length).toBe(1);
    expect(result[0]).toBeDefined();
    expect(result[0].id).toBe("beef-burger");
  });
});

describe("filterExercisesByGroup", () => {
  it("按部位筛选", () => {
    const chest = filterExercisesByGroup("chest");
    expect(chest.length).toBeGreaterThan(0);
    for (const e of chest) expect(e.muscleGroup).toBe("chest");
  });
});

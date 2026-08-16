import { describe, it, expect } from "vitest";
import { exercises } from "@/lib/data/exercises";
import { recipes } from "@/lib/data/recipes";
import { planTemplates } from "@/lib/data/plans";

describe("数据完整性", () => {
  it("动作库覆盖 5 个部位，每部位至少 3 个", () => {
    const groups = ["chest", "shoulder", "back", "legs", "arms"] as const;
    for (const g of groups) {
      expect(exercises.filter((e) => e.muscleGroup === g).length).toBeGreaterThanOrEqual(3);
    }
  });
  it("动作 id 唯一", () => {
    const ids = exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("菜谱覆盖 3 个分类，热量与宏量为正", () => {
    const cats = ["cut", "bulk", "balanced"] as const;
    for (const c of cats) {
      expect(recipes.filter((r) => r.category === c).length).toBeGreaterThanOrEqual(3);
    }
    for (const r of recipes) {
      expect(r.calories).toBeGreaterThan(0);
      expect(r.proteinG).toBeGreaterThan(0);
      expect(r.carbsG).toBeGreaterThanOrEqual(0);
      expect(r.fatG).toBeGreaterThanOrEqual(0);
    }
  });
  it("计划模板引用存在的动作 id", () => {
    const exerciseIds = new Set(exercises.map((e) => e.id));
    for (const day of planTemplates) {
      for (const pe of day.exercises) {
        expect(exerciseIds.has(pe.exerciseId)).toBe(true);
      }
    }
  });
});

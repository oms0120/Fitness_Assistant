import { describe, it, expect } from "vitest";
import { RuleProvider } from "@/lib/ai/ruleProvider";

describe("RuleProvider", () => {
  it("recommendRecipes 返回非空数组", async () => {
    const p = new RuleProvider();
    const result = await p.recommendRecipes({ targetCalories: 1500, proteinRatio: 0.4, carbRatio: 0.4, fatRatio: 0.2, goal: "cut" });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBeTruthy();
  });
  it("generatePlan 返回含动作的计划", async () => {
    const p = new RuleProvider();
    const plan = await p.generatePlan({ muscleGroup: "chest", level: "intermediate", equipment: "杠铃" });
    expect(plan.name).toBeTruthy();
    expect(plan.exercises.length).toBeGreaterThan(0);
  });
});

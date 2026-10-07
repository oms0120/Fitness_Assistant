import { describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";
import { BudgetGuardedProvider } from "@/lib/ai/guardedProvider";
import type { AiProvider } from "@/lib/ai/provider";
import type {
  PlanRequest,
  PlanSuggestion,
  RecipeRequest,
  RecipeSuggestion,
} from "@/lib/ai/types";

const RECIPE_INPUT: RecipeRequest = {
  targetCalories: 1500,
  proteinRatio: 0.4,
  carbRatio: 0.4,
  fatRatio: 0.2,
  goal: "cut",
};
const PLAN_INPUT: PlanRequest = { muscleGroup: "chest", level: "intermediate", equipment: "杠铃" };

function recipe(name: string): RecipeSuggestion {
  return {
    name,
    calories: 1,
    proteinG: 1,
    carbsG: 1,
    fatG: 1,
    ingredients: [],
    steps: [],
    reason: name,
  };
}

/** 假 provider：返回值里带上自己的标签，另外记下被调了几次。 */
function fake(label: string) {
  const calls = { recipes: 0, plans: 0 };
  const provider: AiProvider = {
    async recommendRecipes(): Promise<RecipeSuggestion[]> {
      calls.recipes++;
      return [recipe(label)];
    },
    async generatePlan(): Promise<PlanSuggestion> {
      calls.plans++;
      return { name: label, goal: label, exercises: [] };
    },
  };
  return { provider, calls };
}

describe("BudgetGuardedProvider", () => {
  it("能花钱就走 primary，degraded 为 false", async () => {
    const primary = fake("primary");
    const fallback = fake("fallback");
    const p = new BudgetGuardedProvider(primary.provider, fallback.provider, async () => true);

    expect((await p.recommendRecipes(RECIPE_INPUT))[0].name).toBe("primary");
    expect(p.degraded).toBe(false);
    expect(fallback.calls.recipes).toBe(0);
  });

  it("超预算就整个转给 fallback，并且 degraded 为 true", async () => {
    const primary = fake("primary");
    const fallback = fake("fallback");
    const p = new BudgetGuardedProvider(primary.provider, fallback.provider, async () => false);

    expect((await p.recommendRecipes(RECIPE_INPUT))[0].name).toBe("fallback");
    expect((await p.generatePlan(PLAN_INPUT)).name).toBe("fallback");
    expect(p.degraded).toBe(true);
    // 超预算时一次模型都不该调
    expect(primary.calls.recipes).toBe(0);
    expect(primary.calls.plans).toBe(0);
  });

  it("判定抛异常时当「能花钱」处理——预算库抖一下不该让全站降级到模板", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    const primary = fake("primary");
    const fallback = fake("fallback");
    const p = new BudgetGuardedProvider(primary.provider, fallback.provider, async () => {
      throw new Error("db down");
    });

    expect((await p.generatePlan(PLAN_INPUT)).name).toBe("primary");
    expect(p.degraded).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("两个能力各自问一次判定", async () => {
    const primary = fake("primary");
    const fallback = fake("fallback");
    const canSpend = vi.fn(async () => true);
    const p = new BudgetGuardedProvider(primary.provider, fallback.provider, canSpend);

    await p.recommendRecipes(RECIPE_INPUT);
    await p.generatePlan(PLAN_INPUT);
    expect(canSpend).toHaveBeenCalledTimes(2);
  });

  it("degraded 反映的是最近一次调用，不是「曾经降级过」", async () => {
    const primary = fake("primary");
    const fallback = fake("fallback");
    let allowed = false;
    const p = new BudgetGuardedProvider(primary.provider, fallback.provider, async () => allowed);

    await p.generatePlan(PLAN_INPUT);
    expect(p.degraded).toBe(true);
    allowed = true;
    await p.generatePlan(PLAN_INPUT);
    expect(p.degraded).toBe(false);
  });
});

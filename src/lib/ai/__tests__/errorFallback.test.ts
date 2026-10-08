/**
 * `ErrorFallbackProvider`：模型异常 → 规则库这一格。
 *
 * 钉三件事，每一件都对应一个"漏了会静默错"的地方：
 *
 *   1. 降级必须留下带 requestId 的 warn —— 降级后路由返回 200，异常不再冒到路由的
 *      catch，这条 warn 是**唯一**的痕迹。
 *   2. `degraded` 要把**内层**的也算上 —— 套在 `BudgetGuardedProvider` 外面时，
 *      超预算是内层降的级且不抛异常，只报自己就会把"吃了模板"说成没降级。
 *   3. 兜底自己再失败时**不许吞** —— 那时已无东西可顶，吞掉就是一张空白页。
 *
 * 纯假 provider，不需要网络也不需要 DB。
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { logger } from "@/lib/logger";
import { ErrorFallbackProvider } from "@/lib/ai/errorFallbackProvider";
import type { AiProvider } from "@/lib/ai/provider";
import type { PlanRequest, PlanSuggestion, RecipeRequest, RecipeSuggestion } from "@/lib/ai/types";

const RECIPE_INPUT: RecipeRequest = {
  targetCalories: 1500,
  proteinRatio: 0.4,
  carbRatio: 0.4,
  fatRatio: 0.2,
  goal: "cut",
};
const PLAN_INPUT: PlanRequest = { muscleGroup: "chest", level: "intermediate", equipment: "杠铃" };

function recipe(name: string): RecipeSuggestion {
  return { name, calories: 1, proteinG: 1, carbsG: 1, fatG: 1, ingredients: [], steps: [], reason: name };
}

/** 假 provider：返回值带自己的标签，另外记下被调了几次。 */
function fake(label: string, opts: { throws?: boolean; degraded?: boolean } = {}) {
  const calls = { recipes: 0, plans: 0 };
  const provider: AiProvider = {
    get degraded() {
      return opts.degraded;
    },
    async recommendRecipes(): Promise<RecipeSuggestion[]> {
      calls.recipes++;
      if (opts.throws) throw new Error(`${label} 挂了`);
      return [recipe(label)];
    },
    async generatePlan(): Promise<PlanSuggestion> {
      calls.plans++;
      if (opts.throws) throw new Error(`${label} 挂了`);
      return { name: label, goal: label, exercises: [] };
    },
  };
  return { provider, calls };
}

describe("ErrorFallbackProvider", () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("primary 正常时不碰 fallback，degraded 为 false", async () => {
    const primary = fake("primary");
    const fallback = fake("fallback");
    const p = new ErrorFallbackProvider(primary.provider, fallback.provider);

    expect((await p.recommendRecipes(RECIPE_INPUT))[0].name).toBe("primary");
    expect(p.degraded).toBe(false);
    expect(fallback.calls.recipes).toBe(0);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("primary 抛异常 → 转 fallback，degraded 为 true，并记一条带 requestId 的 warn", async () => {
    const primary = fake("primary", { throws: true });
    const fallback = fake("fallback");
    const p = new ErrorFallbackProvider(primary.provider, fallback.provider, "trace-fallback");

    expect((await p.recommendRecipes(RECIPE_INPUT))[0].name).toBe("fallback");
    expect(p.degraded).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      { err: expect.any(Error), requestId: "trace-fallback" },
      expect.stringContaining("降级到规则库"),
    );
  });

  it("两个能力共用同一套兜底", async () => {
    const primary = fake("primary", { throws: true });
    const fallback = fake("fallback");
    const p = new ErrorFallbackProvider(primary.provider, fallback.provider);

    expect((await p.recommendRecipes(RECIPE_INPUT))[0].name).toBe("fallback");
    expect((await p.generatePlan(PLAN_INPUT)).name).toBe("fallback");
    expect(p.degraded).toBe(true);
  });

  it("内层 provider 自报的 degraded 要算进来 —— 超预算是内层降的级，且它不抛异常", async () => {
    // 这条防的正是「套在 BudgetGuardedProvider 外面」这个组合：
    // 只看本层的 usedFallback 会把「额度用完吃了模板」报成 degraded: false。
    const primary = fake("primary", { degraded: true });
    const fallback = fake("fallback");
    const p = new ErrorFallbackProvider(primary.provider, fallback.provider);

    expect((await p.recommendRecipes(RECIPE_INPUT))[0].name).toBe("primary");
    expect(p.degraded).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled(); // 内层自己记了，本层不该重复打
  });

  it("degraded 反映最近一次调用，不是「曾经降级过」", async () => {
    const fallback = fake("fallback");
    let broken = true;
    // 手动切 primary 的行为：先坏后好
    const p = new ErrorFallbackProvider(
      {
        async recommendRecipes() {
          if (broken) throw new Error("挂了");
          return [recipe("primary")];
        },
        async generatePlan(): Promise<PlanSuggestion> {
          if (broken) throw new Error("挂了");
          return { name: "primary", goal: "primary", exercises: [] };
        },
      },
      fallback.provider,
    );

    expect((await p.generatePlan(PLAN_INPUT)).name).toBe("fallback");
    expect(p.degraded).toBe(true);
    broken = false;
    expect((await p.generatePlan(PLAN_INPUT)).name).toBe("primary");
    expect(p.degraded).toBe(false);
  });

  it("兜底自己也失败时异常冒出去 —— 那时已无东西可顶，吞掉就是空白页", async () => {
    const primary = fake("primary", { throws: true });
    const fallback = fake("fallback", { throws: true });
    const p = new ErrorFallbackProvider(primary.provider, fallback.provider);

    await expect(p.recommendRecipes(RECIPE_INPUT)).rejects.toThrow("fallback 挂了");
  });
});

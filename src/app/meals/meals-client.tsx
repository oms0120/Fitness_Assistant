"use client";

import { useState } from "react";
import { recipes } from "@/lib/data/recipes";
import { matchRecipesByCalories } from "@/lib/mealMatching";
import { findMealPlan } from "@/lib/mealPlanMatching";
import type { MealPlanResult } from "@/lib/mealPlanMatching";
import type { Recipe } from "@/lib/data/types";
import type { RecipeSuggestion } from "@/lib/ai/types";

const CATS = [
  { key: "cut", label: "减脂" },
  { key: "bulk", label: "增肌" },
  { key: "balanced", label: "均衡" },
] as const;

const MACRO_PRESETS = {
  cut: { label: "减脂", carb: 0.4, protein: 0.4, fat: 0.2 },
  bulk: { label: "增肌", carb: 0.5, protein: 0.3, fat: 0.2 },
  maintain: { label: "维持", carb: 0.45, protein: 0.3, fat: 0.25 },
} as const;

function RecipeCard({ r }: { r: Recipe }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div className="font-medium">{r.name}</div>
        <div className="text-sm text-zinc-500">{r.calories} kcal</div>
      </div>
      <div className="mt-2 flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        <span>蛋白 {r.proteinG}g</span>
        <span>碳水 {r.carbsG}g</span>
        <span>脂肪 {r.fatG}g</span>
      </div>
      <div className="mt-3 text-xs text-zinc-500">
        <div>食材：{r.ingredients.join("、")}</div>
        <div className="mt-1">做法：{r.steps.join("；")}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {r.tags.map((t) => (
          <span key={t} className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t}</span>
        ))}
      </div>
    </div>
  );
}

function MealCard({ label, r }: { label: string; r: Recipe }) {
  return (
    <div>
      <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</div>
      <RecipeCard r={r} />
    </div>
  );
}

function AiRecipeCard({ s }: { s: RecipeSuggestion }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div className="font-medium">{s.name}</div>
        <div className="text-sm text-zinc-500">{s.calories} kcal</div>
      </div>
      <div className="mt-2 flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        <span>蛋白 {s.proteinG}g</span>
        <span>碳水 {s.carbsG}g</span>
        <span>脂肪 {s.fatG}g</span>
      </div>
      <div className="mt-3 text-xs text-zinc-500">
        <div>食材：{s.ingredients.join("、")}</div>
        <div className="mt-1">做法：{s.steps.join("；")}</div>
      </div>
      <div className="mt-3 text-xs text-zinc-400">{s.reason}</div>
    </div>
  );
}

export function MealsClient() {
  const [cat, setCat] = useState<"cut" | "bulk" | "balanced">("cut");
  const [target, setTarget] = useState("");
  const [matched, setMatched] = useState<Recipe[] | null>(null);

  const [planGoal, setPlanGoal] = useState<"cut" | "bulk" | "maintain">("cut");
  const [planCalories, setPlanCalories] = useState("");
  const [carbPct, setCarbPct] = useState(40);
  const [proteinPct, setProteinPct] = useState(40);
  const [fatPct, setFatPct] = useState(20);
  const [mealPlan, setMealPlan] = useState<MealPlanResult | null>(null);
  const [planError, setPlanError] = useState("");

  const [aiSuggestions, setAiSuggestions] = useState<RecipeSuggestion[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

  function onPlanGoalChange(g: "cut" | "bulk" | "maintain") {
    setPlanGoal(g);
    const p = MACRO_PRESETS[g];
    setCarbPct(Math.round(p.carb * 100));
    setProteinPct(Math.round(p.protein * 100));
    setFatPct(Math.round(p.fat * 100));
  }

  function onPlanSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPlanError("");
    const kcal = Number(planCalories);
    if (!Number.isFinite(kcal) || kcal <= 0) { setMealPlan(null); return; }
    const sum = carbPct + proteinPct + fatPct;
    if (sum <= 0) { setMealPlan(null); return; }
    const result = findMealPlan({
      targetCalories: kcal,
      carbRatio: carbPct / sum,
      proteinRatio: proteinPct / sum,
      fatRatio: fatPct / sum,
    });
    setMealPlan(result);
    if (!result) setPlanError("未找到合适组合，请调整热量或比例");
  }

  function onMatch(e: React.FormEvent) {
    e.preventDefault();
    const kcal = Number(target);
    if (Number.isFinite(kcal) && kcal > 0) {
      setMatched(matchRecipesByCalories(kcal, 0.1));
    } else {
      setMatched(null);
    }
  }

  async function onAiRecommend() {
    const kcal = Number(planCalories);
    if (!Number.isFinite(kcal) || kcal <= 0) return;
    const sum = carbPct + proteinPct + fatPct;
    if (sum <= 0) return;
    setAiError("");
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/recipes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetCalories: kcal, proteinRatio: proteinPct / sum, carbRatio: carbPct / sum, fatRatio: fatPct / sum, goal: planGoal }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? "AI 生成失败，请稍后重试");
        setAiSuggestions(null);
        return;
      }
      setAiSuggestions(data.suggestions ?? []);
    } catch {
      setAiError("AI 生成失败，请稍后重试");
      setAiSuggestions(null);
    } finally {
      setAiLoading(false);
    }
  }

  const list = recipes.filter((r) => r.category === cat);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-semibold">菜谱库</h1>

      <form onSubmit={onMatch} className="mb-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">按热量匹配食谱</div>
        <div className="flex gap-2">
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="输入目标热量（kcal）"
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">匹配</button>
        </div>
        {matched && (
          <div className="mt-4">
            <div className="mb-2 text-xs text-zinc-500">匹配结果（±10%，按热量差排序）</div>
            <div className="grid gap-3">
              {matched.map((r) => <RecipeCard key={r.id} r={r} />)}
            </div>
          </div>
        )}
      </form>

      <form onSubmit={onPlanSubmit} className="mb-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">组合配餐</div>

        <div className="mb-3 flex gap-2">
          {(Object.keys(MACRO_PRESETS) as Array<"cut" | "bulk" | "maintain">).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onPlanGoalChange(g)}
              className={`rounded-lg px-4 py-2 text-sm ${planGoal === g ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-zinc-700"}`}
            >
              {MACRO_PRESETS[g].label}
            </button>
          ))}
        </div>

        <div className="mb-3">
          <input
            type="number"
            value={planCalories}
            onChange={(e) => setPlanCalories(e.target.value)}
            placeholder="输入目标热量（kcal）"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>

        <div className="mb-3 grid grid-cols-3 gap-2">
          {(
            [
              { label: "碳水 %", value: carbPct, set: setCarbPct },
              { label: "蛋白 %", value: proteinPct, set: setProteinPct },
              { label: "脂肪 %", value: fatPct, set: setFatPct },
            ] as const
          ).map((f) => (
            <label key={f.label} className="text-xs text-zinc-500">
              <span className="mb-1 block">{f.label}</span>
              <input
                type="number"
                min={0}
                value={f.value}
                onChange={(e) => f.set(Number(e.target.value))}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          ))}
        </div>
        <div className="mb-3 text-xs text-zinc-400">* 三个比例提交时会自动归一化为 100%。</div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">生成配餐方案</button>
          <button
            type="button"
            onClick={onAiRecommend}
            disabled={aiLoading}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700"
          >
            {aiLoading ? "生成中…" : "AI 推荐菜谱"}
          </button>
        </div>

        {planError && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{planError}</p>
        )}

        {aiError && (
          <p className="mt-3 text-sm text-amber-600 dark:text-amber-400">{aiError}</p>
        )}

        {aiSuggestions && aiSuggestions.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 text-xs text-zinc-500">AI 推荐菜谱（AI 生成，仅供参考）</div>
            <div className="grid gap-3">
              {aiSuggestions.map((s, i) => <AiRecipeCard key={`${s.name}-${i}`} s={s} />)}
            </div>
          </div>
        )}

        {mealPlan && (
          <div className="mt-4">
            <div className="mb-2 text-xs text-zinc-500">配餐结果（按目标宏量最接近组合）</div>
            <div className="grid gap-3">
              <MealCard label="早餐" r={mealPlan.breakfast} />
              <MealCard label="午餐" r={mealPlan.lunch} />
              <MealCard label="晚餐" r={mealPlan.dinner} />
            </div>
            <div className="mt-4 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <div className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">总计 vs 目标</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                <div>热量 <span className="font-medium">{Math.round(mealPlan.totals.calories)}</span> / {Math.round(mealPlan.targets.calories)} kcal</div>
                <div>蛋白 <span className="font-medium">{Math.round(mealPlan.totals.proteinG)}</span> / {Math.round(mealPlan.targets.proteinG)} g</div>
                <div>碳水 <span className="font-medium">{Math.round(mealPlan.totals.carbsG)}</span> / {Math.round(mealPlan.targets.carbsG)} g</div>
                <div>脂肪 <span className="font-medium">{Math.round(mealPlan.totals.fatG)}</span> / {Math.round(mealPlan.targets.fatG)} g</div>
              </div>
            </div>
          </div>
        )}
      </form>

      <div className="mb-6 flex gap-2">
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={`rounded-lg px-4 py-2 text-sm ${cat === c.key ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((r) => <RecipeCard key={r.id} r={r} />)}
      </div>
      <p className="mt-6 text-xs text-zinc-400">* 热量与宏量为单人份估算，供参考。</p>
    </div>
  );
}

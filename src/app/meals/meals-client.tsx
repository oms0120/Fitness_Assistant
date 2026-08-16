"use client";

import { useState } from "react";
import { recipes } from "@/lib/data/recipes";
import { matchRecipesByCalories } from "@/lib/mealMatching";
import type { Recipe } from "@/lib/data/types";

const CATS = [
  { key: "cut", label: "减脂" },
  { key: "bulk", label: "增肌" },
  { key: "balanced", label: "均衡" },
] as const;

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

export function MealsClient() {
  const [cat, setCat] = useState<"cut" | "bulk" | "balanced">("cut");
  const [target, setTarget] = useState("");
  const [matched, setMatched] = useState<Recipe[] | null>(null);

  function onMatch(e: React.FormEvent) {
    e.preventDefault();
    const kcal = Number(target);
    if (Number.isFinite(kcal) && kcal > 0) {
      setMatched(matchRecipesByCalories(kcal, 0.1));
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

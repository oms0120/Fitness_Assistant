"use client";

import { useState } from "react";
import { calculateMacros, Goal } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function MacrosPage() {
  const [weightKg, setWeightKg] = useState("70");
  const [tdee, setTdee] = useState("2500");
  const [goal, setGoal] = useState<Goal>(Goal.CUT);
  const [calorieFactor, setCalorieFactor] = useState("");
  const [proteinPerKg, setProteinPerKg] = useState("");
  const [fatRatio, setFatRatio] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [result, setResult] = useState<{ calories: number; proteinG: number; fatG: number; carbsG: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const overrides =
      calorieFactor === "" && proteinPerKg === "" && fatRatio === ""
        ? undefined
        : {
            ...(calorieFactor !== "" ? { calorieFactor: Number(calorieFactor) } : {}),
            ...(proteinPerKg !== "" ? { proteinPerKg: Number(proteinPerKg) } : {}),
            ...(fatRatio !== "" ? { fatRatio: Number(fatRatio) } : {}),
          };
    const res = calculateMacros({ tdee: Number(tdee), weightKg: Number(weightKg), goal, overrides });
    if (!res.ok) {
      setResult(null);
      setErrors(res.errors);
      return;
    }
    setErrors({});
    setResult(res.data);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">宏量营养计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="每日总代谢 TDEE" unit="kcal" value={tdee} onChange={setTdee} error={errors.tdee} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">目标</span>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value={Goal.CUT}>减脂</option>
            <option value={Goal.BULK}>增肌</option>
            <option value={Goal.MAINTAIN}>维持</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="w-full rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700"
        >
          {showAdvanced ? "收起高级设置" : "高级设置"}
        </button>
        {showAdvanced && (
          <div className="space-y-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
            <NumberField
              label="热量系数"
              unit="× TDEE"
              value={calorieFactor}
              onChange={setCalorieFactor}
              error={errors["overrides.calorieFactor"]}
            />
            <NumberField
              label="蛋白"
              unit="g/kg"
              value={proteinPerKg}
              onChange={setProteinPerKg}
              error={errors["overrides.proteinPerKg"]}
            />
            <NumberField
              label="脂肪占比"
              unit="0–1"
              value={fatRatio}
              onChange={setFatRatio}
              error={errors["overrides.fatRatio"]}
              step="0.01"
            />
            <p className="text-xs text-zinc-500">留空则使用默认值</p>
          </div>
        )}
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ResultField label="每日总热量" value={`${result.calories.toFixed(0)} kcal`} />
          <ResultField label="蛋白质" value={`${result.proteinG.toFixed(0)} g`} />
          <ResultField label="脂肪" value={`${result.fatG.toFixed(0)} g`} />
          <ResultField label="碳水" value={`${result.carbsG.toFixed(0)} g`} />
        </div>
      )}
    </div>
  );
}

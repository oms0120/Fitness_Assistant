"use client";

import { useState } from "react";
import { calculateBmr, calculateTdee, ActivityLevel, ACTIVITY_FACTORS, ACTIVITY_LEVEL_LABELS } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function BmrPage() {
  const [sex, setSex] = useState("male");
  const [weightKg, setWeightKg] = useState("70");
  const [heightCm, setHeightCm] = useState("175");
  const [age, setAge] = useState("25");
  const [activity, setActivity] = useState<ActivityLevel>(ActivityLevel.MODERATE);
  const [result, setResult] = useState<{ bmr: number; tdee: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function saveResult(bmr: number, tdee: number) {
    try {
      const res = await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "bmr", data: { bmr, tdee, sex, weightKg: Number(weightKg), heightCm: Number(heightCm), age: Number(age), activity } }),
      });
      if (res.status === 401) return; // 未登录静默跳过
    } catch {
      // 静默忽略保存失败
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bmrRes = calculateBmr({ sex, weightKg: Number(weightKg), heightCm: Number(heightCm), age: Number(age) });
    if (!bmrRes.ok) {
      setResult(null);
      setErrors(bmrRes.errors);
      return;
    }
    const tdeeRes = calculateTdee({ bmr: bmrRes.data.bmr, activityLevel: activity });
    if (!tdeeRes.ok) {
      setResult(null);
      setErrors(tdeeRes.errors);
      return;
    }
    setErrors({});
    setResult({ bmr: bmrRes.data.bmr, tdee: tdeeRes.data.tdee });
    void saveResult(bmrRes.data.bmr, tdeeRes.data.tdee);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">BMR / TDEE 计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" checked={sex === "male"} onChange={() => setSex("male")} /> 男
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={sex === "female"} onChange={() => setSex("female")} /> 女
          </label>
        </div>
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="身高" unit="cm" value={heightCm} onChange={setHeightCm} error={errors.heightCm} />
        <NumberField label="年龄" unit="岁" value={age} onChange={setAge} error={errors.age} step="1" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">活动水平</span>
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value as ActivityLevel)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {Object.entries(ACTIVITY_FACTORS).map(([k]) => (
              <option key={k} value={k}>{ACTIVITY_LEVEL_LABELS[k as ActivityLevel]}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ResultField label="基础代谢 BMR" value={`${result.bmr.toFixed(0)} kcal/天`} />
          <ResultField label="每日总代谢 TDEE" value={`${result.tdee.toFixed(0)} kcal/天`} />
        </div>
      )}
    </div>
  );
}

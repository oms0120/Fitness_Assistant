"use client";

import { useState } from "react";
import { calculateOneRm } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function OneRmPage() {
  const [weightKg, setWeightKg] = useState("100");
  const [reps, setReps] = useState("5");
  const [result, setResult] = useState<{ epley: number; brzycki: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = calculateOneRm({ weightKg: Number(weightKg), reps: Number(reps) });
    if (!res.ok) return setErrors(res.errors);
    setErrors({});
    setResult(res.data);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">1RM 计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <NumberField label="重量" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="次数" unit="次" value={reps} onChange={setReps} error={errors.reps} step="1" />
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ResultField label="1RM（Epley）" value={`${result.epley.toFixed(1)} kg`} />
          <ResultField label="1RM（Brzycki）" value={`${result.brzycki.toFixed(1)} kg`} />
        </div>
      )}
    </div>
  );
}

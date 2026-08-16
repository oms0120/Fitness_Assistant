"use client";

import { useState } from "react";
import { calculateFfmi } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function FfmiPage() {
  const [weightKg, setWeightKg] = useState("80");
  const [heightCm, setHeightCm] = useState("180");
  const [bodyFatPct, setBodyFatPct] = useState("15");
  const [result, setResult] = useState<{ leanMassKg: number; ffmi: number; adjustedFfmi: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = calculateFfmi({ weightKg: Number(weightKg), heightCm: Number(heightCm), bodyFatPct: Number(bodyFatPct) });
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
      <h1 className="mb-6 text-2xl font-semibold">FFMI 计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="身高" unit="cm" value={heightCm} onChange={setHeightCm} error={errors.heightCm} />
        <NumberField label="体脂率" unit="%" value={bodyFatPct} onChange={setBodyFatPct} error={errors.bodyFatPct} />
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3">
          <ResultField label="瘦体重" value={`${result.leanMassKg.toFixed(1)} kg`} />
          <ResultField label="FFMI" value={result.ffmi.toFixed(2)} />
          <ResultField label="标准化 FFMI" value={result.adjustedFfmi.toFixed(2)} hint="按身高 1.8m 标准化" />
        </div>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";
import { calculateBodyFat } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function BodyFatPage() {
  const [sex, setSex] = useState("male");
  const [heightCm, setHeightCm] = useState("170");
  const [neckCm, setNeckCm] = useState("40");
  const [waistCm, setWaistCm] = useState("80");
  const [hipCm, setHipCm] = useState("95");
  const [result, setResult] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = calculateBodyFat({
      sex,
      heightCm: Number(heightCm),
      neckCm: Number(neckCm),
      waistCm: Number(waistCm),
      hipCm: sex === "female" ? Number(hipCm) : undefined,
    });
    if (!res.ok) return setErrors(res.errors);
    setErrors({});
    setResult(res.data.bodyFatPct);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">体脂率计算器（美国海军法）</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" checked={sex === "male"} onChange={() => setSex("male")} /> 男
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={sex === "female"} onChange={() => setSex("female")} /> 女
          </label>
        </div>
        <NumberField label="身高" unit="cm" value={heightCm} onChange={setHeightCm} error={errors.heightCm} />
        <NumberField label="颈围" unit="cm" value={neckCm} onChange={setNeckCm} error={errors.neckCm} />
        <NumberField label="腰围" unit="cm" value={waistCm} onChange={setWaistCm} error={errors.waistCm} />
        {sex === "female" && (
          <NumberField label="臀围" unit="cm" value={hipCm} onChange={setHipCm} error={errors.hipCm} />
        )}
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result !== null && (
        <div className="mt-6">
          <ResultField label="体脂率" value={`${result.toFixed(1)}%`} />
        </div>
      )}
    </div>
  );
}

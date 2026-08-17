"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { calculateBmr, calculateTdee, ActivityLevel, ACTIVITY_LEVEL_LABELS } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";

export function ProfileClient() {
  const router = useRouter();
  const [sex, setSex] = useState("male");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [neckCm, setNeckCm] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [hipCm, setHipCm] = useState("");
  const [age, setAge] = useState("");
  const [goal, setGoal] = useState("cut");
  const [activity, setActivity] = useState<ActivityLevel>(ActivityLevel.MODERATE);
  const [msg, setMsg] = useState("");

  const h = Number(heightCm);
  const w = Number(weightKg);
  const a = Number(age);
  let preview: string | null = null;
  if (heightCm && weightKg && age && Number.isFinite(h) && Number.isFinite(w) && Number.isFinite(a)) {
    const r = calculateBmr({ sex, weightKg: w, heightCm: h, age: a });
    if (r.ok) {
      const t = calculateTdee({ bmr: r.data.bmr, activityLevel: activity });
      preview = `BMR ${r.data.bmr.toFixed(0)} kcal · TDEE ${t.ok ? t.data.tdee.toFixed(0) : "-"} kcal`;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sex, heightCm: Number(heightCm), weightKg: Number(weightKg),
        neckCm: Number(neckCm), waistCm: Number(waistCm),
        hipCm: sex === "female" && hipCm ? Number(hipCm) : undefined,
        age: Number(age), goal, activity,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error ?? "保存失败"); return; }
    setMsg("已保存");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">身体档案</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" checked={sex === "male"} onChange={() => setSex("male")} /> 男</label>
          <label className="flex items-center gap-2"><input type="radio" checked={sex === "female"} onChange={() => setSex("female")} /> 女</label>
        </div>
        <NumberField label="身高" unit="cm" value={heightCm} onChange={setHeightCm} />
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} />
        <NumberField label="颈围" unit="cm" value={neckCm} onChange={setNeckCm} />
        <NumberField label="腰围" unit="cm" value={waistCm} onChange={setWaistCm} />
        {sex === "female" && <NumberField label="臀围" unit="cm" value={hipCm} onChange={setHipCm} />}
        <NumberField label="年龄" unit="岁" value={age} onChange={setAge} step="1" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">目标</span>
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            <option value="cut">减脂</option>
            <option value="bulk">增肌</option>
            <option value="maintain">维持</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">活动水平</span>
          <select value={activity} onChange={(e) => setActivity(e.target.value as ActivityLevel)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            {Object.entries(ACTIVITY_LEVEL_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {preview && <p className="text-sm text-zinc-500">{preview}</p>}
        {msg && <p className="text-sm text-zinc-500">{msg}</p>}
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">保存档案</button>
      </form>
    </div>
  );
}

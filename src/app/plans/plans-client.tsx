"use client";

import { useEffect, useState } from "react";
import { planTemplates } from "@/lib/data/plans";
import { exercises } from "@/lib/data/exercises";
import type { PlanDay } from "@/lib/data/types";

const STORAGE_KEY = "training-plans-v1";

function loadPlans(): PlanDay[] {
  if (typeof window === "undefined") return planTemplates;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return planTemplates;
  try {
    return JSON.parse(raw) as PlanDay[];
  } catch {
    return planTemplates;
  }
}

export function PlansClient() {
  const [days, setDays] = useState<PlanDay[]>(planTemplates);
  const [active, setActive] = useState(0);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Read persisted plans from localStorage after hydration (SSR-safe).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDays(loadPlans());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(days));
  }, [days, hydrated]);

  const day = days[active];
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  function updateSets(reps: number, idx: number) {
    setDays((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: d.exercises.map((pe, j) => j !== idx ? pe : { ...pe, sets: reps }),
    }));
  }

  function updateReps(reps: number, idx: number) {
    setDays((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: d.exercises.map((pe, j) => j !== idx ? pe : { ...pe, reps }),
    }));
  }

  function removeExercise(idx: number) {
    setDays((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: d.exercises.filter((_, j) => j !== idx),
    }));
  }

  function addExercise(exerciseId: string) {
    setDays((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: [...d.exercises, { exerciseId, sets: 3, reps: 10 }],
    }));
  }

  function reset() {
    window.localStorage.removeItem(STORAGE_KEY);
    setDays(planTemplates);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">训练计划</h1>
        <button onClick={reset} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">重置为默认</button>
      </div>

      <div className="mb-6 flex gap-2">
        {days.map((d, i) => (
          <button
            key={d.id}
            onClick={() => setActive(i)}
            className={`rounded-lg px-4 py-2 text-sm ${active === i ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {d.name}
          </button>
        ))}
      </div>

      {day && (
        <div className="space-y-3">
          {day.exercises.map((pe, idx) => {
            const ex = exerciseById.get(pe.exerciseId);
            return (
              <div key={`${pe.exerciseId}-${idx}`} className="flex items-center justify-between rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                <div>
                  <div className="font-medium">{ex?.name ?? pe.exerciseId}</div>
                  <div className="text-xs text-zinc-500">{ex?.equipment}</div>
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1 text-sm">
                    组数
                    <input type="number" min={1} value={pe.sets} onChange={(e) => updateSets(Number(e.target.value), idx)} className="w-14 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    次数
                    <input type="number" min={1} value={pe.reps} onChange={(e) => updateReps(Number(e.target.value), idx)} className="w-14 rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  <button onClick={() => removeExercise(idx)} className="text-sm text-red-500">删除</button>
                </div>
              </div>
            );
          })}

          <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
            <label className="mb-2 block text-sm font-medium">添加动作</label>
            <select
              onChange={(e) => { if (e.target.value) addExercise(e.target.value); e.target.value = ""; }}
              defaultValue=""
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              <option value="" disabled>选择动作…</option>
              {exercises.map((e) => (
                <option key={e.id} value={e.id}>{e.name}（{e.muscleGroup}）</option>
              ))}
            </select>
          </div>
        </div>
      )}
      <p className="mt-6 text-xs text-zinc-400">计划自动保存到本地浏览器，重置可恢复默认模板。</p>
    </div>
  );
}

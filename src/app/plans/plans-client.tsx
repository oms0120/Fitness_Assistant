"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { planTemplates } from "@/lib/data/plans";
import { exercises } from "@/lib/data/exercises";
import { MUSCLE_GROUP_LABELS, type MuscleGroup, type PlanDay } from "@/lib/data/types";

export function PlansClient({ authenticated }: { authenticated: boolean }) {
  const [days, setDays] = useState<PlanDay[]>(planTemplates);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      try {
        const res = await fetch("/api/training-plan");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.plan)) setDays(data.plan);
        }
      } catch {
        // 网络异常时保留默认模板
      }
    })();
  }, [authenticated]);

  const day = days[active];
  const exerciseById = new Map(exercises.map((e) => [e.id, e]));

  function mutate(fn: (prev: PlanDay[]) => PlanDay[]) {
    setDays((prev) => {
      const next = fn(prev);
      if (authenticated) {
        fetch("/api/training-plan", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: next }),
        }).catch(() => {});
      }
      return next;
    });
  }

  function updateSets(reps: number, idx: number) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: d.exercises.map((pe, j) => j !== idx ? pe : { ...pe, sets: reps }),
    }));
  }

  function updateReps(reps: number, idx: number) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: d.exercises.map((pe, j) => j !== idx ? pe : { ...pe, reps }),
    }));
  }

  function removeExercise(idx: number) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: d.exercises.filter((_, j) => j !== idx),
    }));
  }

  function addExercise(exerciseId: string) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : {
      ...d,
      exercises: [...d.exercises, { exerciseId, sets: 3, reps: 10 }],
    }));
  }

  function reset() {
    mutate(() => planTemplates);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-semibold">训练计划</h1>
        {authenticated ? (
          <button onClick={reset} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">重置为默认</button>
        ) : (
          <Link href="/login" className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white dark:bg-white dark:text-black">登录后编辑</Link>
        )}
      </div>

      {!authenticated && (
        <p className="mb-6 rounded-lg bg-zinc-100 px-4 py-3 text-sm text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          当前为只读预设模板，<Link href="/login" className="underline">登录</Link>后可编辑并同步到云端。
        </p>
      )}

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
                    <input type="number" min={1} disabled={!authenticated} value={pe.sets} onChange={(e) => updateSets(Math.max(1, Number(e.target.value) || 1), idx)} className="w-14 rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    次数
                    <input type="number" min={1} disabled={!authenticated} value={pe.reps} onChange={(e) => updateReps(Math.max(1, Number(e.target.value) || 1), idx)} className="w-14 rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  {authenticated && <button onClick={() => removeExercise(idx)} className="text-sm text-red-500">删除</button>}
                </div>
              </div>
            );
          })}

          {authenticated && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
              <label className="mb-2 block text-sm font-medium">添加动作</label>
              <select
                onChange={(e) => { if (e.target.value) addExercise(e.target.value); e.target.value = ""; }}
                defaultValue=""
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="" disabled>选择动作…</option>
                {(Object.keys(MUSCLE_GROUP_LABELS) as MuscleGroup[]).map((group) => (
                  <optgroup key={group} label={MUSCLE_GROUP_LABELS[group]}>
                    {exercises.filter((e) => e.muscleGroup === group).map((e) => (
                      <option key={e.id} value={e.id}>{e.name}（{MUSCLE_GROUP_LABELS[e.muscleGroup]}）</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
      {authenticated && <p className="mt-6 text-xs text-zinc-400">调整会自动保存到云端，多端同步。</p>}
    </div>
  );
}

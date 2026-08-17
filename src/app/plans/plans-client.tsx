"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { planTemplates } from "@/lib/data/plans";
import { exercises } from "@/lib/data/exercises";
import { MUSCLE_GROUP_LABELS, DIFFICULTY_LABELS, type MuscleGroup, type PlanDay } from "@/lib/data/types";
import type { PlanSuggestion } from "@/lib/ai/types";

const LEVELS = [
  { key: "beginner", label: DIFFICULTY_LABELS.beginner },
  { key: "intermediate", label: DIFFICULTY_LABELS.intermediate },
  { key: "advanced", label: DIFFICULTY_LABELS.advanced },
] as const;

const EQUIPMENT_OPTIONS = ["不限", "杠铃", "哑铃", "器械", "自重"] as const;

export function PlansClient({ authenticated }: { authenticated: boolean }) {
  const [days, setDays] = useState<PlanDay[]>(planTemplates);
  const [active, setActive] = useState(0);

  const [level, setLevel] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [equipment, setEquipment] = useState<string>("不限");
  const [aiPlan, setAiPlan] = useState<PlanSuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");

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

  async function onAiPlan() {
    if (!day) return;
    setAiError("");
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ muscleGroup: day.muscleGroup, level, equipment }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error ?? "AI 生成失败，请稍后重试");
        setAiPlan(null);
        return;
      }
      setAiPlan(data.plan ?? null);
    } catch {
      setAiError("AI 生成失败，请稍后重试");
      setAiPlan(null);
    } finally {
      setAiLoading(false);
    }
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

      {authenticated && (
        <div className="mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <div className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">AI 生成计划</div>
          <div className="mb-3 flex flex-wrap gap-2">
            {LEVELS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLevel(l.key)}
                className={`rounded-lg px-4 py-2 text-sm ${level === l.key ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-zinc-700"}`}
              >
                {l.label}
              </button>
            ))}
            <select
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            >
              {EQUIPMENT_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={onAiPlan}
              disabled={aiLoading}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {aiLoading ? "生成中…" : "AI 生成计划"}
            </button>
          </div>

          {aiError && (
            <p className="text-sm text-amber-600 dark:text-amber-400">{aiError}</p>
          )}

          {aiPlan && (
            <div className="mt-4">
              <div className="mb-2 text-xs text-zinc-500">AI 生成，仅供参考</div>
              <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{aiPlan.name}</div>
                  <div className="text-sm text-zinc-500">{aiPlan.goal}</div>
                </div>
                <div className="mt-3 space-y-2">
                  {aiPlan.exercises.map((ex, i) => (
                    <div key={`${ex.name}-${i}`} className="flex items-center justify-between text-sm">
                      <div className="text-zinc-700 dark:text-zinc-300">{ex.name}</div>
                      <div className="text-zinc-500">{ex.sets} 组 × {ex.reps} 次</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {authenticated && <p className="mt-6 text-xs text-zinc-400">调整会自动保存到云端，多端同步。</p>}
    </div>
  );
}

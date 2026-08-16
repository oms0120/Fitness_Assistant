"use client";

import { useState } from "react";
import { exercises } from "@/lib/data/exercises";
import type { MuscleGroup } from "@/lib/data/types";

const GROUPS: { key: MuscleGroup; label: string }[] = [
  { key: "chest", label: "胸" },
  { key: "shoulder", label: "肩" },
  { key: "back", label: "背" },
  { key: "legs", label: "腿" },
  { key: "arms", label: "臂" },
];

export function ExercisesClient() {
  const [group, setGroup] = useState<MuscleGroup>("chest");
  const list = exercises.filter((e) => e.muscleGroup === group);
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-semibold">动作库</h1>
      <div className="mb-6 flex gap-2">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            onClick={() => setGroup(g.key)}
            className={`rounded-lg px-4 py-2 text-sm ${group === g.key ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((e) => (
          <div key={e.id} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div className="font-medium">{e.name}</div>
              <span className="text-xs text-zinc-500">{e.difficulty}</span>
            </div>
            <div className="mt-1 text-sm text-zinc-500">{e.equipment}</div>
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">{e.instructions}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

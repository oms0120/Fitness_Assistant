# 训练计划云端同步 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。

**目标：** 训练计划从 localStorage 升级为数据库存储，登录后多端同步。

**架构：** Prisma 新增 `TrainingPlan` 模型 + Route Handlers（GET/PUT）+ plans 页登录态改造。复用阶段 2 的 `planTemplates`/`exercises` 和阶段 3 的 `auth()`/prisma 单例。

**技术栈：** Next.js 16、Prisma、Auth.js v5。

**规格来源：** `docs/superpowers/specs/2026-08-16-training-plan-sync-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `prisma/schema.prisma` | 新增 TrainingPlan 模型 |
| `src/app/api/training-plan/route.ts` | GET/PUT 云端读写 |
| `src/app/plans/page.tsx` | 服务端壳（登录态判断） |
| `src/app/plans/plans-client.tsx` | 客户端（登录态 + API 读写） |

---

## 任务 1：Prisma TrainingPlan 模型 + 迁移

**文件：** 修改 `prisma/schema.prisma`

- [ ] **步骤 1：加 TrainingPlan 模型**

在 User 模型里加关系 `trainingPlan TrainingPlan?`，并在文件末尾加：

```prisma
model TrainingPlan {
  id        String   @id @default(cuid())
  userId    String   @unique
  data      String
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

User 模型加一行 `trainingPlan TrainingPlan?`。

- [ ] **步骤 2：迁移**

```bash
npx prisma migrate dev --name add_training_plan
```

- [ ] **步骤 3：Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add training plan model"
```

---

## 任务 2：TrainingPlan API

**文件：** 创建 `src/app/api/training-plan/route.ts`

- [ ] **步骤 1：创建 route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const record = await prisma.trainingPlan.findUnique({
    where: { userId: session.user.id },
  });
  if (!record) return NextResponse.json({ plan: null });
  return NextResponse.json({ plan: JSON.parse(record.data) });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const data = body?.data;
  if (!Array.isArray(data)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const record = await prisma.trainingPlan.upsert({
    where: { userId: session.user.id },
    update: { data: JSON.stringify(data) },
    create: { userId: session.user.id, data: JSON.stringify(data) },
  });
  return NextResponse.json({ ok: true, updatedAt: record.updatedAt });
}
```

- [ ] **步骤 2：验证**

运行：`npm run build`
预期：build 成功

- [ ] **步骤 3：Commit**

```bash
git add src/app/api/training-plan/
git commit -m "feat: add training plan api"
```

---

## 任务 3：plans 页改造

**文件：**
- 修改 `src/app/plans/page.tsx`
- 修改 `src/app/plans/plans-client.tsx`

- [ ] **步骤 1：先 Read 现有 `src/app/plans/page.tsx` 和 `plans-client.tsx`，了解阶段 2 结构**

- [ ] **步骤 2：改造 plans/page.tsx 为服务端壳**

```tsx
import { auth } from "@/auth";
import { PlansClient } from "./plans-client";

export default async function PlansPage() {
  const session = await auth();
  return <PlansClient authenticated={Boolean(session?.user?.id)} />;
}
```

- [ ] **步骤 3：改造 plans-client.tsx**

保留阶段 2 的编辑 UI（改 sets/reps、增删动作、重置、部位 tab），改动如下：
1. 移除 localStorage（`STORAGE_KEY`、`loadPlans`、读写 localStorage 的 useEffect）
2. props 加 `authenticated: boolean`
3. `useEffect` 登录时 GET 加载：有 `plan` 用云端，无则用 `planTemplates`
4. 编辑操作后（增删改、重置），登录时调用 `PUT /api/training-plan` 保存
5. 未登录时：渲染只读（编辑控件 disabled 或隐藏），顶部提示「登录后可编辑并同步」+ `/login` 链接

完整改造参考：

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { planTemplates } from "@/lib/data/plans";
import { exercises } from "@/lib/data/exercises";
import type { PlanDay } from "@/lib/data/types";

export function PlansClient({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();
  const [days, setDays] = useState<PlanDay[]>(planTemplates);
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!authenticated) { setLoaded(true); return; }
    (async () => {
      const res = await fetch("/api/training-plan");
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.plan)) setDays(data.plan);
      }
      setLoaded(true);
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
        }).then(() => setSaved(true));
      }
      return next;
    });
  }

  function updateSets(reps: number, idx: number) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : { ...d, exercises: d.exercises.map((pe, j) => j !== idx ? pe : { ...pe, sets: reps }) }));
  }
  function updateReps(reps: number, idx: number) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : { ...d, exercises: d.exercises.map((pe, j) => j !== idx ? pe : { ...pe, reps }) }));
  }
  function removeExercise(idx: number) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : { ...d, exercises: d.exercises.filter((_, j) => j !== idx) }));
  }
  function addExercise(exerciseId: string) {
    mutate((prev) => prev.map((d, i) => i !== active ? d : { ...d, exercises: [...d.exercises, { exerciseId, sets: 3, reps: 10 }] }));
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
          <button key={d.id} onClick={() => setActive(i)} className={`rounded-lg px-4 py-2 text-sm ${active === i ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-zinc-700"}`}>
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
                    <input type="number" min={1} disabled={!authenticated} value={pe.sets} onChange={(e) => updateSets(Number(e.target.value), idx)} className="w-14 rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  <label className="flex items-center gap-1 text-sm">
                    次数
                    <input type="number" min={1} disabled={!authenticated} value={pe.reps} onChange={(e) => updateReps(Number(e.target.value), idx)} className="w-14 rounded border border-zinc-300 px-2 py-1 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900" />
                  </label>
                  {authenticated && <button onClick={() => removeExercise(idx)} className="text-sm text-red-500">删除</button>}
                </div>
              </div>
            );
          })}

          {authenticated && (
            <div className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-zinc-700">
              <label className="mb-2 block text-sm font-medium">添加动作</label>
              <select onChange={(e) => { if (e.target.value) addExercise(e.target.value); e.target.value = ""; }} defaultValue="" className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
                <option value="" disabled>选择动作…</option>
                {exercises.map((e) => <option key={e.id} value={e.id}>{e.name}（{e.muscleGroup}）</option>)}
              </select>
            </div>
          )}
        </div>
      )}
      {authenticated && <p className="mt-6 text-xs text-zinc-400">调整会自动保存到云端，多端同步。</p>}
    </div>
  );
}
```

> 注意：实现者需先读阶段 2 的现有 plans-client.tsx，保留其结构（可能已被最终审查修复过：组数次数 clamp 到 ≥1、localStorage 校验等），按上述意图改造。`mutate` 里的 `fetch` 需加 `.catch(() => {})` 防未处理 rejection；`Number("")=0` 的 clamp 用 `Math.max(1, Number(e.target.value))`。

- [ ] **步骤 4：验证**

运行：`npm run lint && npm run build`
预期：lint 0 error，build 成功

- [ ] **步骤 5：Commit**

```bash
git add src/app/plans/
git commit -m "feat: sync training plan to cloud"
```

---

## 任务 4：集成验证

- [ ] **步骤 1：全量验证**

```bash
npm test && npm run lint && npm run build
```

- [ ] **步骤 2：冒烟（dev server）**

未登录访问 `/plans` 显示只读模板 + 登录提示；登录后能编辑并保存，刷新后保留。

- [ ] **步骤 3：Commit 并推送**

```bash
git push
```

---

## 自检记录

- **规格覆盖度**：TrainingPlan 模型（任务 1）、GET/PUT API（任务 2）、plans 页登录态改造（任务 3）、集成验证（任务 4）均覆盖。
- **占位符**：任务 3 标注「先读现有 plans-client.tsx，保留其结构」，因阶段 2 的最终审查可能已改过该文件（clamp、校验），需实现者谨慎合并。
- **类型一致性**：`PlanDay` 类型复用 `src/lib/data/types.ts`；`TrainingPlan.data` 存 `PlanDay[]` 的 JSON，API 层 `JSON.parse`/`JSON.stringify` 对称。

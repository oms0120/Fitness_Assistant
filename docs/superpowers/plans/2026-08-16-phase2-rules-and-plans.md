# 阶段 2 实现计划：规则库 + 菜谱 / 动作库 / 训练计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现动作库（胸肩背腿臂）、菜谱库（分类浏览 + 热量匹配 + 碳蛋脂展示）、可编辑训练计划（localStorage 保存），并更新首页多入口导航。

**架构：** 静态 TS 数据（`src/lib/data/`）+ 纯函数逻辑（`src/lib/`，含热量匹配单测）+ 服务端/客户端组件页面。延续阶段 1 的纯数据 + 组件模式。

**技术栈：** Next.js 16 (App Router)、TypeScript、Tailwind v4、shadcn/ui、vitest。

**规格来源：** `docs/superpowers/specs/2026-08-16-phase2-rules-and-plans-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/data/types.ts` | `MuscleGroup`、`Exercise`、`Recipe`、`PlanDay` 类型 |
| `src/lib/data/exercises.ts` | 动作库（20 个动作，5 部位） |
| `src/lib/data/recipes.ts` | 菜谱库（12 个菜谱，3 分类） |
| `src/lib/data/plans.ts` | 训练计划模板（5 部位日） |
| `src/lib/data/index.ts` | 数据统一导出 |
| `src/lib/mealMatching.ts` | `matchRecipesByCalories`、`filterExercisesByGroup` |
| `src/lib/__tests__/mealMatching.test.ts` | 匹配逻辑单测 |
| `src/lib/__tests__/data.test.ts` | 数据完整性测试 |
| `src/app/exercises/page.tsx` | 动作库页（部位 tab） |
| `src/app/meals/page.tsx` | 菜谱库页（分类 + 热量匹配） |
| `src/app/plans/page.tsx` | 训练计划页（可编辑 + localStorage） |
| `src/app/page.tsx` | 首页多入口导航（修改） |

---

## 任务 1：类型 + 动作库数据

**文件：**
- 创建：`src/lib/data/types.ts`
- 创建：`src/lib/data/exercises.ts`

- [ ] **步骤 1：创建 types.ts**

```ts
export type MuscleGroup = "chest" | "shoulder" | "back" | "legs" | "arms";

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  equipment: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  instructions: string;
}

export interface Recipe {
  id: string;
  name: string;
  category: "cut" | "bulk" | "balanced";
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  ingredients: string[];
  steps: string[];
  tags: string[];
}

export interface PlanExercise {
  exerciseId: string;
  sets: number;
  reps: number;
}

export interface PlanDay {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  exercises: PlanExercise[];
}
```

- [ ] **步骤 2：创建 exercises.ts（20 个动作）**

```ts
import type { Exercise } from "./types";

export const exercises: Exercise[] = [
  // 胸 chest
  { id: "barbell-bench-press", name: "杠铃卧推", muscleGroup: "chest", equipment: "杠铃", difficulty: "intermediate", instructions: "平躺于卧推凳，双手略宽于肩握杠，下放至胸部轻触后推起。" },
  { id: "incline-dumbbell-press", name: "上斜哑铃卧推", muscleGroup: "chest", equipment: "哑铃", difficulty: "intermediate", instructions: "上斜凳约 30 度，双手持哑铃自胸部两侧向上推举。" },
  { id: "dumbbell-fly", name: "哑铃飞鸟", muscleGroup: "chest", equipment: "哑铃", difficulty: "beginner", instructions: "平躺持哑铃，双臂微屈自两侧向胸前合拢，感受胸肌拉伸与收缩。" },
  { id: "push-up", name: "俯卧撑", muscleGroup: "chest", equipment: "自重", difficulty: "beginner", instructions: "身体保持直线，屈肘下降至胸部接近地面后推起。" },
  // 肩 shoulder
  { id: "seated-dumbbell-press", name: "坐姿哑铃推举", muscleGroup: "shoulder", equipment: "哑铃", difficulty: "intermediate", instructions: "坐姿挺背，双手持哑铃自肩部向上推举至手臂伸直。" },
  { id: "dumbbell-lateral-raise", name: "哑铃侧平举", muscleGroup: "shoulder", equipment: "哑铃", difficulty: "beginner", instructions: "站立持哑铃，双臂微屈向两侧平举至与肩同高。" },
  { id: "overhead-press", name: "杠铃站姿推举", muscleGroup: "shoulder", equipment: "杠铃", difficulty: "advanced", instructions: "站立持杠于锁骨前，向上推举至头顶上方伸直。" },
  { id: "reverse-fly", name: "反向飞鸟", muscleGroup: "shoulder", equipment: "哑铃", difficulty: "beginner", instructions: "俯身持哑铃，双臂向两侧展开，锻炼三角肌后束。" },
  // 背 back
  { id: "pull-up", name: "引体向上", muscleGroup: "back", equipment: "自重", difficulty: "intermediate", instructions: "正握单杠，身体悬垂后向上拉起至下巴过杠。" },
  { id: "barbell-row", name: "杠铃划船", muscleGroup: "back", equipment: "杠铃", difficulty: "intermediate", instructions: "俯身挺背，持杠沿大腿方向拉至腹部。" },
  { id: "lat-pulldown", name: "高位下拉", muscleGroup: "back", equipment: "器械", difficulty: "beginner", instructions: "坐姿握横杆，向下拉至锁骨上方，控制回放。" },
  { id: "seated-cable-row", name: "坐姿划船", muscleGroup: "back", equipment: "器械", difficulty: "beginner", instructions: "坐姿握把手，向后拉至腹部，肩胛后缩。" },
  // 腿 legs
  { id: "barbell-squat", name: "深蹲", muscleGroup: "legs", equipment: "杠铃", difficulty: "intermediate", instructions: "杠铃置于上背，屈髋屈膝下蹲至大腿平行地面后站起。" },
  { id: "deadlift", name: "硬拉", muscleGroup: "legs", equipment: "杠铃", difficulty: "advanced", instructions: "屈髋俯身握杠，伸髋伸膝将杠铃拉起至直立。" },
  { id: "leg-press", name: "腿举", muscleGroup: "legs", equipment: "器械", difficulty: "beginner", instructions: "坐于腿举机，双脚蹬踏板，屈膝下放后蹬起。" },
  { id: "lunge", name: "箭步蹲", muscleGroup: "legs", equipment: "自重", difficulty: "beginner", instructions: "向前跨步下蹲，前膝约 90 度，交替进行。" },
  // 臂 arms
  { id: "barbell-curl", name: "杠铃弯举", muscleGroup: "arms", equipment: "杠铃", difficulty: "beginner", instructions: "站立持杠，屈肘将杠铃弯举至胸前。" },
  { id: "hammer-curl", name: "哑铃锤式弯举", muscleGroup: "arms", equipment: "哑铃", difficulty: "beginner", instructions: "持哑铃掌心相对，屈肘弯举，锻炼肱肌与前臂。" },
  { id: "cable-pushdown", name: "绳索下压", muscleGroup: "arms", equipment: "器械", difficulty: "beginner", instructions: "握绳索，肘固定，向下压至手臂伸直，锻炼肱三头肌。" },
  { id: "close-grip-bench-press", name: "窄距卧推", muscleGroup: "arms", equipment: "杠铃", difficulty: "intermediate", instructions: "窄握距卧推，下放至胸部，重点刺激肱三头肌。" },
];
```

- [ ] **步骤 3：Commit**

```bash
git add src/lib/data/types.ts src/lib/data/exercises.ts
git commit -m "feat: add exercise types and library"
```

---

## 任务 2：菜谱数据

**文件：**
- 创建：`src/lib/data/recipes.ts`

- [ ] **步骤 1：创建 recipes.ts（12 个菜谱）**

```ts
import type { Recipe } from "./types";

export const recipes: Recipe[] = [
  // 减脂 cut
  { id: "chicken-broccoli", name: "鸡胸肉西兰花", category: "cut", calories: 320, proteinG: 42, carbsG: 15, fatG: 10, ingredients: ["鸡胸肉 150g", "西兰花 200g", "橄榄油 5g", "盐、黑胡椒适量"], steps: ["鸡胸肉切块用盐、黑胡椒腌制", "西兰花焯水", "热锅少油煎鸡胸肉至熟，与西兰花同炒"], tags: ["高蛋白", "低脂", "快手"] },
  { id: "steamed-fish-veggies", name: "清蒸鱼配蔬菜", category: "cut", calories: 280, proteinG: 35, carbsG: 10, fatG: 10, ingredients: ["鲈鱼 200g", "青菜 150g", "姜丝、葱适量", "蒸鱼豉油少许"], steps: ["鱼身划刀铺姜丝葱段", "水开后蒸 8 分钟", "青菜焯水摆盘，淋少许豉油"], tags: ["高蛋白", "低脂"] },
  { id: "shrimp-salad", name: "虾仁蔬菜沙拉", category: "cut", calories: 250, proteinG: 30, carbsG: 12, fatG: 8, ingredients: ["虾仁 150g", "生菜、番茄、黄瓜适量", "橄榄油 5g", "柠檬汁少许"], steps: ["虾仁焯水至熟", "蔬菜洗净切块", "混合后淋橄榄油与柠檬汁"], tags: ["低脂", "快手", "清爽"] },
  { id: "egg-white-oatmeal", name: "鸡蛋白燕麦粥", category: "cut", calories: 300, proteinG: 25, carbsG: 35, fatG: 6, ingredients: ["燕麦 40g", "鸡蛋白 4 个", "脱脂牛奶 200ml", "蓝莓少许"], steps: ["燕麦加牛奶煮至浓稠", "倒入鸡蛋白搅匀煮熟", "点缀蓝莓"], tags: ["高蛋白", "早餐"] },
  // 增肌 bulk
  { id: "beef-fried-rice", name: "牛肉炒饭", category: "bulk", calories: 550, proteinG: 30, carbsG: 60, fatG: 18, ingredients: ["牛肉末 120g", "米饭 200g", "鸡蛋 1 个", "胡萝卜、豌豆适量"], steps: ["牛肉末炒熟", "下米饭与蔬菜翻炒", "打入鸡蛋炒散调味"], tags: ["高碳水", "增肌"] },
  { id: "chicken-pasta", name: "鸡胸肉意面", category: "bulk", calories: 600, proteinG: 35, carbsG: 70, fatG: 15, ingredients: ["鸡胸肉 150g", "意面 100g（干重）", "番茄酱 50g", "橄榄油 8g"], steps: ["意面煮至八分熟", "鸡胸肉切条煎熟", "混合意面、鸡肉与番茄酱"], tags: ["高碳水", "增肌"] },
  { id: "salmon-mashed-potato", name: "三文鱼土豆泥", category: "bulk", calories: 580, proteinG: 32, carbsG: 45, fatG: 28, ingredients: ["三文鱼 150g", "土豆 250g", "牛奶 50ml", "黄油 5g"], steps: ["土豆蒸熟压泥，加牛奶黄油拌匀", "三文鱼煎至两面金黄", "组合装盘"], tags: ["高蛋白", "优质脂肪"] },
  { id: "beef-burger", name: "牛肉汉堡配薯条", category: "bulk", calories: 650, proteinG: 35, carbsG: 55, fatG: 30, ingredients: ["牛肉饼 120g", "汉堡胚 1 个", "土豆 150g", "生菜、番茄适量"], steps: ["牛肉饼煎熟", "土豆切条烤或煎至金黄", "组装汉堡配薯条"], tags: ["高热量", "增肌"] },
  // 均衡 balanced
  { id: "tomato-egg-rice", name: "番茄炒蛋配米饭", category: "balanced", calories: 450, proteinG: 18, carbsG: 55, fatG: 15, ingredients: ["番茄 2 个", "鸡蛋 2 个", "米饭 200g", "食用油 10g"], steps: ["鸡蛋炒散盛出", "番茄炒软后回锅鸡蛋", "配米饭"], tags: ["家常", "快手"] },
  { id: "chicken-veggie-stirfry", name: "清炒时蔬鸡丁", category: "balanced", calories: 400, proteinG: 28, carbsG: 20, fatG: 20, ingredients: ["鸡胸肉 120g", "彩椒、西兰花、胡萝卜适量", "食用油 10g", "蒜末适量"], steps: ["鸡丁腌制后炒熟", "蔬菜下锅快炒", "混合调味"], tags: ["高蛋白", "均衡"] },
  { id: "mixed-grain-chicken", name: "杂粮饭配烤鸡腿", category: "balanced", calories: 500, proteinG: 32, carbsG: 50, fatG: 18, ingredients: ["去皮鸡腿 1 个", "杂粮饭 180g", "西兰花 150g", "香料适量"], steps: ["鸡腿用香料腌制后烤熟", "杂粮饭煮熟", "配焯水西兰花"], tags: ["均衡", "高蛋白"] },
  { id: "tofu-noodle-soup", name: "豆腐菌菇汤面", category: "balanced", calories: 420, proteinG: 20, carbsG: 50, fatG: 14, ingredients: ["豆腐 150g", "面条 100g（干重）", "菌菇 100g", "青菜适量"], steps: ["菌菇煮汤底", "下豆腐与面条煮熟", "加青菜调味"], tags: ["清淡", "均衡"] },
];
```

- [ ] **步骤 2：Commit**

```bash
git add src/lib/data/recipes.ts
git commit -m "feat: add recipe library"
```

---

## 任务 3：训练计划模板数据

**文件：**
- 创建：`src/lib/data/plans.ts`
- 创建：`src/lib/data/index.ts`

- [ ] **步骤 1：创建 plans.ts（5 个部位日）**

```ts
import type { PlanDay } from "./types";

export const planTemplates: PlanDay[] = [
  { id: "chest-day", name: "胸日", muscleGroup: "chest", exercises: [
    { exerciseId: "barbell-bench-press", sets: 4, reps: 10 },
    { exerciseId: "incline-dumbbell-press", sets: 3, reps: 10 },
    { exerciseId: "dumbbell-fly", sets: 3, reps: 12 },
    { exerciseId: "push-up", sets: 3, reps: 15 },
  ]},
  { id: "shoulder-day", name: "肩日", muscleGroup: "shoulder", exercises: [
    { exerciseId: "seated-dumbbell-press", sets: 4, reps: 10 },
    { exerciseId: "dumbbell-lateral-raise", sets: 3, reps: 15 },
    { exerciseId: "reverse-fly", sets: 3, reps: 15 },
    { exerciseId: "overhead-press", sets: 3, reps: 8 },
  ]},
  { id: "back-day", name: "背日", muscleGroup: "back", exercises: [
    { exerciseId: "pull-up", sets: 4, reps: 8 },
    { exerciseId: "barbell-row", sets: 3, reps: 10 },
    { exerciseId: "lat-pulldown", sets: 3, reps: 12 },
    { exerciseId: "seated-cable-row", sets: 3, reps: 12 },
  ]},
  { id: "legs-day", name: "腿日", muscleGroup: "legs", exercises: [
    { exerciseId: "barbell-squat", sets: 4, reps: 8 },
    { exerciseId: "deadlift", sets: 3, reps: 6 },
    { exerciseId: "leg-press", sets: 3, reps: 12 },
    { exerciseId: "lunge", sets: 3, reps: 12 },
  ]},
  { id: "arms-day", name: "臂日", muscleGroup: "arms", exercises: [
    { exerciseId: "barbell-curl", sets: 4, reps: 10 },
    { exerciseId: "hammer-curl", sets: 3, reps: 12 },
    { exerciseId: "cable-pushdown", sets: 3, reps: 12 },
    { exerciseId: "close-grip-bench-press", sets: 3, reps: 10 },
  ]},
];
```

- [ ] **步骤 2：创建 index.ts**

```ts
export * from "./types";
export * from "./exercises";
export * from "./recipes";
export * from "./plans";
```

- [ ] **步骤 3：Commit**

```bash
git add src/lib/data/plans.ts src/lib/data/index.ts
git commit -m "feat: add training plan templates and data barrel"
```

---

## 任务 4：匹配逻辑 + 单测（TDD）

**文件：**
- 创建：`src/lib/mealMatching.ts`
- 测试：`src/lib/__tests__/mealMatching.test.ts`
- 测试：`src/lib/__tests__/data.test.ts`

- [ ] **步骤 1：编写失败测试 mealMatching.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { matchRecipesByCalories, filterExercisesByGroup } from "@/lib/mealMatching";
import { recipes } from "@/lib/data/recipes";
import { exercises } from "@/lib/data/exercises";

describe("matchRecipesByCalories", () => {
  it("返回热量在 ±10% 内的菜谱，按差值升序", () => {
    const result = matchRecipesByCalories(300, 0.1);
    expect(result.length).toBeGreaterThan(0);
    // 每个结果都在 270-330 范围内
    for (const r of result) {
      expect(r.calories).toBeGreaterThanOrEqual(270);
      expect(r.calories).toBeLessThanOrEqual(330);
    }
    // 按差值升序
    for (let i = 1; i < result.length; i++) {
      expect(Math.abs(result[i].calories - 300)).toBeGreaterThanOrEqual(Math.abs(result[i - 1].calories - 300));
    }
  });
  it("无匹配时返回最接近的 1 个", () => {
    const result = matchRecipesByCalories(9999, 0.1);
    expect(result.length).toBe(1);
    expect(result[0]).toBeDefined();
  });
});

describe("filterExercisesByGroup", () => {
  it("按部位筛选", () => {
    const chest = filterExercisesByGroup("chest");
    expect(chest.length).toBeGreaterThan(0);
    for (const e of chest) expect(e.muscleGroup).toBe("chest");
  });
});
```

- [ ] **步骤 2：编写失败测试 data.test.ts（数据完整性）**

```ts
import { describe, it, expect } from "vitest";
import { exercises } from "@/lib/data/exercises";
import { recipes } from "@/lib/data/recipes";
import { planTemplates } from "@/lib/data/plans";

describe("数据完整性", () => {
  it("动作库覆盖 5 个部位，每部位至少 3 个", () => {
    const groups = ["chest", "shoulder", "back", "legs", "arms"] as const;
    for (const g of groups) {
      expect(exercises.filter((e) => e.muscleGroup === g).length).toBeGreaterThanOrEqual(3);
    }
  });
  it("动作 id 唯一", () => {
    const ids = exercises.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("菜谱覆盖 3 个分类，热量与宏量为正", () => {
    const cats = ["cut", "bulk", "balanced"] as const;
    for (const c of cats) {
      expect(recipes.filter((r) => r.category === c).length).toBeGreaterThanOrEqual(3);
    }
    for (const r of recipes) {
      expect(r.calories).toBeGreaterThan(0);
      expect(r.proteinG).toBeGreaterThan(0);
      expect(r.carbsG).toBeGreaterThanOrEqual(0);
      expect(r.fatG).toBeGreaterThanOrEqual(0);
    }
  });
  it("计划模板引用存在的动作 id", () => {
    const exerciseIds = new Set(exercises.map((e) => e.id));
    for (const day of planTemplates) {
      for (const pe of day.exercises) {
        expect(exerciseIds.has(pe.exerciseId)).toBe(true);
      }
    }
  });
});
```

- [ ] **步骤 3：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/mealMatching'`

- [ ] **步骤 4：创建 mealMatching.ts**

```ts
import type { Exercise, MuscleGroup, Recipe } from "./data/types";
import { recipes } from "./data/recipes";
import { exercises } from "./data/exercises";

export function matchRecipesByCalories(targetKcal: number, tolerance = 0.1): Recipe[] {
  const lo = targetKcal * (1 - tolerance);
  const hi = targetKcal * (1 + tolerance);
  const inRange = recipes.filter((r) => r.calories >= lo && r.calories <= hi);
  const sorted = [...inRange].sort((a, b) => Math.abs(a.calories - targetKcal) - Math.abs(b.calories - targetKcal));
  if (sorted.length > 0) return sorted;
  // 无匹配：返回最接近的 1 个
  const closest = [...recipes].sort((a, b) => Math.abs(a.calories - targetKcal) - Math.abs(b.calories - targetKcal));
  return closest.slice(0, 1);
}

export function filterExercisesByGroup(group: MuscleGroup): Exercise[] {
  return exercises.filter((e) => e.muscleGroup === group);
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/lib/mealMatching.ts src/lib/__tests__/
git commit -m "feat: add meal matching logic and data integrity tests"
```

---

## 任务 5：动作库页 + 菜谱库页

**文件：**
- 创建：`src/app/exercises/page.tsx`
- 创建：`src/app/meals/page.tsx`

- [ ] **步骤 1：创建 exercises 页（服务端组件 + 部位 tab 客户端子组件）**

`src/app/exercises/page.tsx`：

```tsx
import { ExercisesClient } from "./exercises-client";

export default function ExercisesPage() {
  return <ExercisesClient />;
}
```

`src/app/exercises/exercises-client.tsx`：

```tsx
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
```

- [ ] **步骤 2：创建 meals 页（分类浏览 + 热量匹配）**

`src/app/meals/page.tsx`：

```tsx
import { MealsClient } from "./meals-client";

export default function MealsPage() {
  return <MealsClient />;
}
```

`src/app/meals/meals-client.tsx`：

```tsx
"use client";

import { useState } from "react";
import { recipes } from "@/lib/data/recipes";
import { matchRecipesByCalories } from "@/lib/mealMatching";
import type { Recipe } from "@/lib/data/types";

const CATS = [
  { key: "cut", label: "减脂" },
  { key: "bulk", label: "增肌" },
  { key: "balanced", label: "均衡" },
] as const;

function RecipeCard({ r }: { r: Recipe }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <div className="font-medium">{r.name}</div>
        <div className="text-sm text-zinc-500">{r.calories} kcal</div>
      </div>
      <div className="mt-2 flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
        <span>蛋白 {r.proteinG}g</span>
        <span>碳水 {r.carbsG}g</span>
        <span>脂肪 {r.fatG}g</span>
      </div>
      <div className="mt-3 text-xs text-zinc-500">
        <div>食材：{r.ingredients.join("、")}</div>
        <div className="mt-1">做法：{r.steps.join("；")}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        {r.tags.map((t) => (
          <span key={t} className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{t}</span>
        ))}
      </div>
    </div>
  );
}

export function MealsClient() {
  const [cat, setCat] = useState<"cut" | "bulk" | "balanced">("cut");
  const [target, setTarget] = useState("");
  const [matched, setMatched] = useState<Recipe[] | null>(null);

  function onMatch(e: React.FormEvent) {
    e.preventDefault();
    const kcal = Number(target);
    if (Number.isFinite(kcal) && kcal > 0) {
      setMatched(matchRecipesByCalories(kcal, 0.1));
    }
  }

  const list = recipes.filter((r) => r.category === cat);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-semibold">菜谱库</h1>

      <form onSubmit={onMatch} className="mb-8 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <div className="mb-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">按热量匹配食谱</div>
        <div className="flex gap-2">
          <input
            type="number"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="输入目标热量（kcal）"
            className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button type="submit" className="rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">匹配</button>
        </div>
        {matched && (
          <div className="mt-4">
            <div className="mb-2 text-xs text-zinc-500">匹配结果（±10%，按热量差排序）</div>
            <div className="grid gap-3">
              {matched.map((r) => <RecipeCard key={r.id} r={r} />)}
            </div>
          </div>
        )}
      </form>

      <div className="mb-6 flex gap-2">
        {CATS.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={`rounded-lg px-4 py-2 text-sm ${cat === c.key ? "bg-zinc-900 text-white dark:bg-white dark:text-black" : "border border-zinc-300 dark:border-zinc-700"}`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((r) => <RecipeCard key={r.id} r={r} />)}
      </div>
      <p className="mt-6 text-xs text-zinc-400">* 热量与宏量为单人份估算，供参考。</p>
    </div>
  );
}
```

- [ ] **步骤 3：验证**

运行：`npm run lint && npm run build`
预期：lint 无错误，build 成功，`/exercises` 和 `/meals` 路由生成

- [ ] **步骤 4：Commit**

```bash
git add src/app/exercises/ src/app/meals/
git commit -m "feat: add exercises and meals pages"
```

---

## 任务 6：训练计划页（可编辑 + localStorage）

**文件：**
- 创建：`src/app/plans/page.tsx`
- 创建：`src/app/plans/plans-client.tsx`

- [ ] **步骤 1：创建 plans 页**

`src/app/plans/page.tsx`：

```tsx
import { PlansClient } from "./plans-client";

export default function PlansPage() {
  return <PlansClient />;
}
```

- [ ] **步骤 2：创建 plans-client.tsx（可编辑计划）**

```tsx
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
```

- [ ] **步骤 3：验证**

运行：`npm run lint && npm run build`
预期：lint 无错误，build 成功，`/plans` 路由生成

- [ ] **步骤 4：Commit**

```bash
git add src/app/plans/
git commit -m "feat: add editable training plans page"
```

---

## 任务 7：首页多入口导航 + 集成验证

**文件：**
- 修改：`src/app/page.tsx`

- [ ] **步骤 1：修改首页为多入口导航**

```tsx
import Link from "next/link";

const items = [
  { href: "/calculators", name: "计算器", desc: "代谢 / 体脂 / 宏量 / FFMI / 1RM" },
  { href: "/exercises", name: "动作库", desc: "胸、肩、背、腿、臂动作" },
  { href: "/plans", name: "训练计划", desc: "分部位训练模板，可自行调整" },
  { href: "/meals", name: "菜谱库", desc: "减脂 / 增肌 / 均衡，支持按热量匹配" },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-semibold">智能健身助手</h1>
      <p className="mt-3 text-zinc-500">身体代谢 · 体脂 · 营养 · 训练</p>
      <div className="mt-10 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="rounded-xl border border-zinc-200 p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600">
            <div className="text-lg font-medium">{it.name}</div>
            <div className="mt-1 text-sm text-zinc-500">{it.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：全量验证**

```bash
npm test && npm run lint && npm run build
```

预期：测试全绿（含数据完整性 + 匹配逻辑）、lint 无错误、build 成功（含 /exercises、/meals、/plans 路由）

- [ ] **步骤 3：Commit 并推送**

```bash
git add src/app/page.tsx
git commit -m "feat: add home navigation entries"
git push
```

---

## 自检记录

- **规格覆盖度**：动作库（任务 1）、菜谱（任务 2）、计划模板（任务 3）、热量匹配（任务 4）、动作库页（任务 5）、菜谱库页（任务 5）、训练计划可编辑 + localStorage（任务 6）、首页导航（任务 7）均覆盖。
- **占位符**：无 TODO，所有数据/代码步骤含完整内容。
- **类型一致性**：`MuscleGroup` 类型贯穿 types/exercises/plans/mealMatching；`Recipe` 字段与 meals 页展示一致；`PlanDay.exercises[].exerciseId` 与 `exercises.id` 关联（data.test.ts 校验引用完整性）。

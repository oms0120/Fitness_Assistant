# 组合配餐 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。

**目标：** 输入目标热量 + 宏量比例，从菜谱库组合早/午/晚 3 餐，使总热量与总宏量最接近目标。

**架构：** Recipe 加 `mealType` 字段 + 穷举打分算法（`src/lib/mealPlanMatching.ts` 纯函数）+ `/meals` 页配餐区块。

**技术栈：** Next.js 16、TypeScript、vitest。

**规格来源：** `docs/superpowers/specs/2026-08-16-meal-plan-matching-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/data/types.ts` | Recipe 加 `mealType` 字段 |
| `src/lib/data/recipes.ts` | 12 个菜谱标 mealType + 新增 2 个早餐 |
| `src/lib/mealPlanMatching.ts` | 配餐算法（穷举 + 打分） |
| `src/lib/__tests__/mealPlanMatching.test.ts` | 算法单测 |
| `src/app/meals/meals-client.tsx` | 加组合配餐区块 |

---

## 任务 1：Recipe mealType + 早餐菜谱补充

**文件：**
- 修改：`src/lib/data/types.ts`
- 修改：`src/lib/data/recipes.ts`

- [ ] **步骤 1：types.ts Recipe 加 mealType**

`Recipe` 接口加字段 `mealType: "breakfast" | "meal";`

- [ ] **步骤 2：recipes.ts 标注 mealType + 新增 2 个早餐**

现有 12 个菜谱：`egg-white-oatmeal` 标 `"breakfast"`，其余 11 个标 `"meal"`。新增 2 个早餐：

```ts
{ id: "whole-wheat-egg-toast", name: "全麦面包煎蛋", category: "balanced", mealType: "breakfast", calories: 380, proteinG: 20, carbsG: 40, fatG: 16, ingredients: ["全麦面包 2 片", "鸡蛋 2 个", "牛奶 100ml"], steps: ["鸡蛋煎至两面金黄", "全麦面包烤热", "组合装盘配牛奶"], tags: ["早餐", "均衡"] },
{ id: "yogurt-oat-bowl", name: "牛奶燕麦酸奶杯", category: "balanced", mealType: "breakfast", calories: 350, proteinG: 18, carbsG: 45, fatG: 12, ingredients: ["燕麦 40g", "酸奶 150g", "牛奶 100ml", "蓝莓少许"], steps: ["燕麦加牛奶煮软", "拌入酸奶", "点缀蓝莓"], tags: ["早餐", "高蛋白"] },
```

注意：给每个现有菜谱的 Recipe 对象加 `mealType` 字段（`egg-white-oatmeal` 为 `"breakfast"`，其余 `"meal"`）。

- [ ] **步骤 3：验证**

运行：`npx tsc --noEmit`
预期：通过

- [ ] **步骤 4：Commit**

```bash
git add src/lib/data/types.ts src/lib/data/recipes.ts
git commit -m "feat: add recipe meal type and breakfast items"
```

---

## 任务 2：配餐算法 + 单测（TDD）

**文件：**
- 创建：`src/lib/mealPlanMatching.ts`
- 测试：`src/lib/__tests__/mealPlanMatching.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { findMealPlan, deriveTargetMacros } from "@/lib/mealPlanMatching";

describe("deriveTargetMacros", () => {
  it("按比例推导宏量", () => {
    const m = deriveTargetMacros(2000, { carbRatio: 0.4, proteinRatio: 0.4, fatRatio: 0.2 });
    expect(m.proteinG).toBeCloseTo(200, 2);  // 2000*0.4/4
    expect(m.carbsG).toBeCloseTo(200, 2);    // 2000*0.4/4
    expect(m.fatG).toBeCloseTo(44.44, 2);    // 2000*0.2/9
  });
});

describe("findMealPlan", () => {
  it("返回早/午/晚 3 餐，早餐是 breakfast 类", () => {
    const result = findMealPlan({ targetCalories: 1500, carbRatio: 0.4, proteinRatio: 0.4, fatRatio: 0.2 });
    expect(result).not.toBeNull();
    if (result) {
      expect(result.breakfast.mealType).toBe("breakfast");
      expect(result.lunch.mealType).toBe("meal");
      expect(result.dinner.mealType).toBe("meal");
      // totals 正确
      expect(result.totals.calories).toBeCloseTo(result.breakfast.calories + result.lunch.calories + result.dinner.calories, 2);
      expect(result.totals.proteinG).toBeCloseTo(result.breakfast.proteinG + result.lunch.proteinG + result.dinner.proteinG, 2);
    }
  });
  it("宏量比例极端时仍能返回结果", () => {
    const result = findMealPlan({ targetCalories: 3000, carbRatio: 0.6, proteinRatio: 0.3, fatRatio: 0.1 });
    expect(result).not.toBeNull();
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/mealPlanMatching'`

- [ ] **步骤 3：创建 mealPlanMatching.ts**

```ts
import type { Recipe } from "./data/types";
import { recipes } from "./data/recipes";

export interface MacroRatios {
  carbRatio: number;
  proteinRatio: number;
  fatRatio: number;
}

export interface MealPlanResult {
  breakfast: Recipe;
  lunch: Recipe;
  dinner: Recipe;
  totals: { calories: number; proteinG: number; carbsG: number; fatG: number };
  targets: { calories: number; proteinG: number; carbsG: number; fatG: number };
  score: number;
}

export function deriveTargetMacros(targetCalories: number, ratios: MacroRatios) {
  return {
    calories: targetCalories,
    proteinG: (targetCalories * ratios.proteinRatio) / 4,
    carbsG: (targetCalories * ratios.carbRatio) / 4,
    fatG: (targetCalories * ratios.fatRatio) / 9,
  };
}

export function findMealPlan(input: { targetCalories: number } & MacroRatios): MealPlanResult | null {
  const targets = deriveTargetMacros(input.targetCalories, {
    carbRatio: input.carbRatio,
    proteinRatio: input.proteinRatio,
    fatRatio: input.fatRatio,
  });

  const breakfasts = recipes.filter((r) => r.mealType === "breakfast");
  const meals = recipes.filter((r) => r.mealType === "meal");

  let best: MealPlanResult | null = null;
  let bestScore = Infinity;

  for (const breakfast of breakfasts) {
    for (const lunch of meals) {
      for (const dinner of meals) {
        const totals = {
          calories: breakfast.calories + lunch.calories + dinner.calories,
          proteinG: breakfast.proteinG + lunch.proteinG + dinner.proteinG,
          carbsG: breakfast.carbsG + lunch.carbsG + dinner.carbsG,
          fatG: breakfast.fatG + lunch.fatG + dinner.fatG,
        };
        const score =
          Math.abs(totals.calories - targets.calories) / targets.calories +
          Math.abs(totals.proteinG - targets.proteinG) / targets.proteinG +
          Math.abs(totals.carbsG - targets.carbsG) / targets.carbsG +
          Math.abs(totals.fatG - targets.fatG) / targets.fatG;
        if (score < bestScore) {
          bestScore = score;
          best = { breakfast, lunch, dinner, totals, targets, score };
        }
      }
    }
  }
  return best;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/mealPlanMatching.ts src/lib/__tests__/mealPlanMatching.test.ts
git commit -m "feat: add meal plan matching algorithm"
```

---

## 任务 3：/meals 页加配餐区块

**文件：** 修改 `src/app/meals/meals-client.tsx`

- [ ] **步骤 1：先 Read 现有 meals-client.tsx 了解结构**

- [ ] **步骤 2：加配餐区块**

在现有热量匹配 form 下方加「组合配餐」区块：

```tsx
const MACRO_PRESETS = {
  cut: { label: "减脂", carb: 0.4, protein: 0.4, fat: 0.2 },
  bulk: { label: "增肌", carb: 0.5, protein: 0.3, fat: 0.2 },
  maintain: { label: "维持", carb: 0.45, protein: 0.3, fat: 0.25 },
} as const;

// 配餐 state：
const [planGoal, setPlanGoal] = useState<"cut" | "bulk" | "maintain">("cut");
const [planCalories, setPlanCalories] = useState("");
const [carbPct, setCarbPct] = useState(40);
const [proteinPct, setProteinPct] = useState(40);
const [fatPct, setFatPct] = useState(20);
const [mealPlan, setMealPlan] = useState<MealPlanResult | null>(null);

function onPlanGoalChange(g: "cut" | "bulk" | "maintain") {
  setPlanGoal(g);
  const p = MACRO_PRESETS[g];
  setCarbPct(Math.round(p.carb * 100));
  setProteinPct(Math.round(p.protein * 100));
  setFatPct(Math.round(p.fat * 100));
}

function onPlanSubmit(e: React.FormEvent) {
  e.preventDefault();
  const kcal = Number(planCalories);
  if (!Number.isFinite(kcal) || kcal <= 0) return;
  const sum = carbPct + proteinPct + fatPct;
  if (sum <= 0) return;
  const result = findMealPlan({
    targetCalories: kcal,
    carbRatio: carbPct / sum,
    proteinRatio: proteinPct / sum,
    fatRatio: fatPct / sum,
  });
  setMealPlan(result);
}
```

配餐结果渲染：早餐/午餐/晚餐 3 张卡片 + 总热量/宏量 vs 目标对比（复用现有 RecipeCard 或新卡片）。

> 比例归一化：用户输入的 3 个百分比求和后归一（`/sum`），避免用户输非 100% 时出错。

- [ ] **步骤 3：验证**

运行：`npm run lint && npm run build`
预期：lint 0 error，build 成功

- [ ] **步骤 4：Commit**

```bash
git add src/app/meals/
git commit -m "feat: add meal plan matching ui"
```

---

## 任务 4：集成验证

- [ ] **步骤 1：全量验证**

```bash
npm test && npm run lint && npm run build
```

- [ ] **步骤 2：冒烟（dev server）**

访问 `/meals`，输入目标热量 + 选择方案，验证配餐结果正常展示。

- [ ] **步骤 3：Commit 并推送**

```bash
git push
```

---

## 自检记录

- **规格覆盖度**：mealType 字段 + 早餐补充（任务 1）、穷举打分算法 + 单测（任务 2）、配餐 UI（任务 3）、集成验证（任务 4）均覆盖。
- **占位符**：任务 3 的配餐结果渲染标注「复用 RecipeCard 或新卡片」，需实现者读现有 meals-client 后确定。
- **类型一致性**：`MealPlanResult` 复用 `Recipe` 类型；比例归一化逻辑在 UI 层（`/sum`），算法层假设比例已归一。

# LLM 增强 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）逐任务实现。

**目标：** 接入 Claude（claude-opus-5）提供 AI 菜谱推荐与训练计划生成，作为规则库增强，未配 key 时回退规则库。

**架构：** `AiProvider` 抽象（RuleProvider 默认 + ClaudeProvider）+ `getProvider()` 开关 + server 端 API route + UI 按钮。

**技术栈：** Next.js 16、TypeScript、`@anthropic-ai/sdk`、zod、vitest。

**规格来源：** `docs/superpowers/specs/2026-08-16-llm-enhancement-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/ai/types.ts` | 输入类型 + AI 输出 zod schema |
| `src/lib/ai/provider.ts` | `AiProvider` 接口 + `getProvider()` |
| `src/lib/ai/ruleProvider.ts` | 规则库实现（默认） |
| `src/lib/ai/claudeProvider.ts` | Claude 实现 |
| `src/lib/ai/__tests__/ruleProvider.test.ts` | 规则库单测 |
| `src/app/api/ai/recipes/route.ts` | AI 菜谱 API |
| `src/app/api/ai/plan/route.ts` | AI 训练计划 API |
| `src/app/meals/meals-client.tsx` | 加 AI 推荐按钮 |
| `src/app/plans/plans-client.tsx` | 加 AI 生成按钮 |

---

## 任务 1：安装 SDK + AI 类型与 schema

**文件：** 修改 `package.json`；创建 `src/lib/ai/types.ts`

- [ ] **步骤 1：安装 SDK**

```bash
npm install @anthropic-ai/sdk
```

- [ ] **步骤 2：创建 types.ts**

```ts
import { z } from "zod";

export interface RecipeRequest {
  targetCalories: number;
  proteinRatio: number;
  carbRatio: number;
  fatRatio: number;
  goal: "cut" | "bulk" | "maintain";
}

export interface PlanRequest {
  muscleGroup: string;
  level: "beginner" | "intermediate" | "advanced";
  equipment: string;
}

export const recipeSuggestionSchema = z.object({
  name: z.string(),
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  reason: z.string(),
});
export type RecipeSuggestion = z.infer<typeof recipeSuggestionSchema>;

export const recipeSuggestionsSchema = z.object({
  suggestions: z.array(recipeSuggestionSchema),
});

export const planExerciseSchema = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.number(),
});
export const planSuggestionSchema = z.object({
  name: z.string(),
  goal: z.string(),
  exercises: z.array(planExerciseSchema),
});
export type PlanSuggestion = z.infer<typeof planSuggestionSchema>;
```

- [ ] **步骤 3：验证 + Commit**

```bash
npx tsc --noEmit
git add package.json package-lock.json src/lib/ai/types.ts
git commit -m "feat: add ai types and schemas"
```

---

## 任务 2：provider 接口 + 规则库实现 + 单测

**文件：** 创建 `src/lib/ai/provider.ts`、`src/lib/ai/ruleProvider.ts`、`src/lib/ai/__tests__/ruleProvider.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { RuleProvider } from "@/lib/ai/ruleProvider";

describe("RuleProvider", () => {
  it("recommendRecipes 返回非空数组", async () => {
    const p = new RuleProvider();
    const result = await p.recommendRecipes({ targetCalories: 1500, proteinRatio: 0.4, carbRatio: 0.4, fatRatio: 0.2, goal: "cut" });
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].name).toBeTruthy();
  });
  it("generatePlan 返回含动作的计划", async () => {
    const p = new RuleProvider();
    const plan = await p.generatePlan({ muscleGroup: "chest", level: "intermediate", equipment: "杠铃" });
    expect(plan.name).toBeTruthy();
    expect(plan.exercises.length).toBeGreaterThan(0);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/ai/ruleProvider'`

- [ ] **步骤 3：创建 provider.ts**

```ts
import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { RuleProvider } from "./ruleProvider";
import { ClaudeProvider } from "./claudeProvider";

export interface AiProvider {
  recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]>;
  generatePlan(input: PlanRequest): Promise<PlanSuggestion>;
}

export function getProvider(): AiProvider {
  const mode = process.env.AI_PROVIDER;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (mode === "claude" && hasKey) return new ClaudeProvider();
  return new RuleProvider();
}
```

- [ ] **步骤 4：创建 ruleProvider.ts**

```ts
import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { recipes } from "@/lib/data/recipes";
import { planTemplates } from "@/lib/data/plans";
import { exercises } from "@/lib/data/exercises";
import { findMealPlan } from "@/lib/mealPlanMatching";

export class RuleProvider {
  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    // 复用组合配餐算法找最优 3 餐，转成建议
    const plan = findMealPlan({
      targetCalories: input.targetCalories,
      carbRatio: input.carbRatio,
      proteinRatio: input.proteinRatio,
      fatRatio: input.fatRatio,
    });
    if (!plan) return [];
    const toSuggestion = (r: (typeof recipes)[number]): RecipeSuggestion => ({
      name: r.name,
      calories: r.calories,
      proteinG: r.proteinG,
      carbsG: r.carbsG,
      fatG: r.fatG,
      ingredients: r.ingredients,
      steps: r.steps,
      reason: "按你的热量与宏量目标匹配",
    });
    return [plan.breakfast, plan.lunch, plan.dinner].map(toSuggestion);
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    const template = planTemplates.find((t) => t.muscleGroup === input.muscleGroup) ?? planTemplates[0];
    const exerciseById = new Map(exercises.map((e) => [e.id, e]));
    return {
      name: template.name,
      goal: `${input.muscleGroup} 训练`,
      exercises: template.exercises.map((pe) => ({
        name: exerciseById.get(pe.exerciseId)?.name ?? pe.exerciseId,
        sets: pe.sets,
        reps: pe.reps,
      })),
    };
  }
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/lib/ai/provider.ts src/lib/ai/ruleProvider.ts src/lib/ai/__tests__/
git commit -m "feat: add ai provider interface and rule provider"
```

---

## 任务 3：ClaudeProvider

**文件：** 创建 `src/lib/ai/claudeProvider.ts`

- [ ] **步骤 1：创建 claudeProvider.ts**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import { recipeSuggestionsSchema, planSuggestionSchema } from "./types";

const client = new Anthropic(); // 从 ANTHROPIC_API_KEY 环境变量读

export class ClaudeProvider {
  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: "你是注册营养师，根据用户的热量与宏量目标推荐中式家常菜谱，热量和宏量尽量贴近目标。输出 JSON。",
      messages: [{ role: "user", content: JSON.stringify(input) }],
      output_config: { format: zodOutputFormat(recipeSuggestionsSchema) },
    });
    return response.parsed_output?.suggestions ?? [];
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    const response = await client.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: "你是健身教练，根据部位、水平、器械生成训练计划。输出 JSON。",
      messages: [{ role: "user", content: JSON.stringify(input) }],
      output_config: { format: zodOutputFormat(planSuggestionSchema) },
    });
    if (!response.parsed_output) {
      throw new Error("AI 训练计划生成失败");
    }
    return response.parsed_output;
  }
}
```

- [ ] **步骤 2：验证**

运行：`npm run build`
预期：build 成功（Claude SDK 类型正确编译）

- [ ] **步骤 3：Commit**

```bash
git add src/lib/ai/claudeProvider.ts
git commit -m "feat: add claude provider"
```

---

## 任务 4：API route

**文件：** 创建 `src/app/api/ai/recipes/route.ts`、`src/app/api/ai/plan/route.ts`

- [ ] **步骤 1：创建 recipes route**

```ts
import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";

export async function POST(req: Request) {
  const body = await req.json();
  const provider = getProvider();
  try {
    const suggestions = await provider.recommendRecipes(body);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}
```

- [ ] **步骤 2：创建 plan route**

```ts
import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";

export async function POST(req: Request) {
  const body = await req.json();
  const provider = getProvider();
  try {
    const plan = await provider.generatePlan(body);
    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}
```

- [ ] **步骤 3：验证 + Commit**

```bash
npm run build
git add src/app/api/ai/
git commit -m "feat: add ai api routes"
```

---

## 任务 5：UI 按钮

**文件：** 修改 `src/app/meals/meals-client.tsx`、`src/app/plans/plans-client.tsx`

- [ ] **步骤 1：先 Read 两个 client 文件了解结构**

- [ ] **步骤 2：/meals 加「AI 推荐菜谱」**

在配餐区块加一个按钮，点击调 `/api/ai/recipes`，展示建议（复用 RecipeCard 或新卡片）：

```tsx
const [aiSuggestions, setAiSuggestions] = useState<RecipeSuggestion[] | null>(null);
const [aiLoading, setAiLoading] = useState(false);

async function onAiRecommend() {
  const kcal = Number(planCalories);
  if (!Number.isFinite(kcal) || kcal <= 0) return;
  const sum = carbPct + proteinPct + fatPct;
  if (sum <= 0) return;
  setAiLoading(true);
  try {
    const res = await fetch("/api/ai/recipes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetCalories: kcal, proteinRatio: proteinPct / sum, carbRatio: carbPct / sum, fatRatio: fatPct / sum, goal: planGoal }),
    });
    const data = await res.json();
    setAiSuggestions(data.suggestions ?? []);
  } finally {
    setAiLoading(false);
  }
}
```

- [ ] **步骤 3：/plans 加「AI 生成计划」**

登录后加按钮，点击调 `/api/ai/plan`（body 用当前部位 + level + equipment），展示返回的计划。

- [ ] **步骤 4：验证 + Commit**

```bash
npm run lint && npm run build
git add src/app/meals/ src/app/plans/
git commit -m "feat: add ai buttons to meals and plans"
```

---

## 任务 6：集成验证

- [ ] **步骤 1：全量验证**

```bash
npm test && npm run lint && npm run build
```

- [ ] **步骤 2：冒烟（无 key 时回退规则库）**

`npm run dev` 后点「AI 推荐菜谱」，无 ANTHROPIC_API_KEY 时应返回规则库匹配结果（不报错）。

- [ ] **步骤 3：Commit 并推送**

```bash
git push
```

---

## 自检记录

- **规格覆盖度**：SDK + schema（任务 1）、provider 接口 + 规则库（任务 2）、ClaudeProvider（任务 3）、API（任务 4）、UI（任务 5）、验证（任务 6）均覆盖。
- **测试策略**：RuleProvider 有单测（可无 key 测试）；ClaudeProvider 无法真实测试（无 key），用 build + tsc 验证编译。
- **类型一致性**：`RecipeSuggestion`/`PlanSuggestion` 复用 types.ts 的 zod 推断类型；RuleProvider 与 ClaudeProvider 都实现 `AiProvider` 接口。
- **降级**：`getProvider()` 无 key 时返回 RuleProvider，API route 永不因缺 key 报错（Claude 调用异常由 try/catch 兜底）。

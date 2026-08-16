# 核心计算器 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 实现 6 个确定性健身计算器（BMR/TDEE、体脂率、宏量营养、FFMI、1RM）为纯函数库 + 独立路由页面。

**架构：** 纯函数库 + 客户端即时计算。计算逻辑集中在 `src/lib/calculators/`，zod 校验输入返回结构化 `Result`，React 客户端组件 import 纯函数输入即算。纯函数无副作用，阶段 3 服务端可复用。

**技术栈：** Next.js 16 (App Router)、TypeScript、Tailwind v4、shadcn/ui、zod、vitest。

**规格来源：** `docs/superpowers/specs/2026-08-16-core-calculators-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `vitest.config.ts` | vitest 配置 + `@/*` 别名 |
| `src/lib/calculators/types.ts` | 枚举 Sex/Goal/ActivityLevel + 活动系数常量 + 默认宏量常量 |
| `src/lib/calculators/result.ts` | `Result<T>` 类型 + `flattenZodErrors` |
| `src/lib/calculators/bmr.ts` | Mifflin-St Jeor 基础代谢 |
| `src/lib/calculators/tdee.ts` | BMR × 活动系数 |
| `src/lib/calculators/bodyFat.ts` | 美国海军体脂法 |
| `src/lib/calculators/macros.ts` | 减脂/增肌/维持宏量营养 |
| `src/lib/calculators/ffmi.ts` | 去脂体重指数 + 标准化 |
| `src/lib/calculators/oneRm.ts` | Epley + Brzycki 1RM |
| `src/lib/calculators/index.ts` | 统一导出 |
| `src/lib/calculators/__tests__/*.test.ts` | 各模块 Vitest 单测 |
| `src/app/calculators/page.tsx` | 计算器卡片网格导航 |
| `src/app/calculators/{bmr,body-fat,macros,ffmi,one-rm}/page.tsx` | 各计算器页 |
| `src/components/calculators/*.tsx` | 共享表单/结果组件 |

---

## 任务 1：测试与校验环境

**文件：**
- 创建：`vitest.config.ts`
- 修改：`package.json`

- [ ] **步骤 1：安装依赖**

```bash
npm install zod && npm install -D vitest
```

- [ ] **步骤 2：创建 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **步骤 3：在 package.json 添加 test script**

在 `"scripts"` 中添加：

```json
"test": "vitest run"
```

- [ ] **步骤 4：验证**

运行：`npm test`
预期：`No test files found`（vitest 正常启动，暂无测试）

- [ ] **步骤 5：Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest and zod"
```

---

## 任务 2：共享类型与结果工具

**文件：**
- 创建：`src/lib/calculators/types.ts`
- 创建：`src/lib/calculators/result.ts`
- 测试：`src/lib/calculators/__tests__/result.test.ts`

- [ ] **步骤 1：编写 result.test.ts 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { flattenZodErrors } from "@/lib/calculators/result";

describe("flattenZodErrors", () => {
  it("把字段错误压平成 Record", () => {
    const schema = z.object({ weightKg: z.number().min(30, "体重过小") });
    const parsed = schema.safeParse({ weightKg: 10 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = flattenZodErrors(parsed.error);
      expect(errors.weightKg).toBe("体重过小");
    }
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/calculators/result'`

- [ ] **步骤 3：创建 types.ts**

```ts
export enum Sex {
  MALE = "male",
  FEMALE = "female",
}

export enum Goal {
  CUT = "cut",
  BULK = "bulk",
  MAINTAIN = "maintain",
}

export enum ActivityLevel {
  SEDENTARY = "sedentary",
  LIGHT = "light",
  MODERATE = "moderate",
  HIGH = "high",
  EXTREME = "extreme",
}

export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  [ActivityLevel.SEDENTARY]: 1.2,
  [ActivityLevel.LIGHT]: 1.375,
  [ActivityLevel.MODERATE]: 1.55,
  [ActivityLevel.HIGH]: 1.725,
  [ActivityLevel.EXTREME]: 1.9,
};

// 宏量营养默认值（高级设置可覆盖）
export const MACRO_DEFAULTS = {
  calorieFactor: {
    [Goal.CUT]: 0.8,
    [Goal.BULK]: 1.1,
    [Goal.MAINTAIN]: 1.0,
  },
  proteinPerKg: {
    [Goal.CUT]: 2.2,
    [Goal.BULK]: 1.8,
    [Goal.MAINTAIN]: 1.8,
  },
  fatRatio: 0.25,
} as const;
```

- [ ] **步骤 4：创建 result.ts**

```ts
import { z } from "zod";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; errors: Record<string, string> };

export function flattenZodErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function parseResult<T>(
  schema: z.ZodType<T>,
  input: unknown,
): Result<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: flattenZodErrors(parsed.error) };
  }
  return { ok: true, data: parsed.data };
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/lib/calculators/types.ts src/lib/calculators/result.ts src/lib/calculators/__tests__/result.test.ts
git commit -m "feat: add calculator shared types and result helper"
```

---

## 任务 3：BMR 与 TDEE

**文件：**
- 创建：`src/lib/calculators/bmr.ts`
- 创建：`src/lib/calculators/tdee.ts`
- 测试：`src/lib/calculators/__tests__/bmr-tdee.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { calculateBmr } from "@/lib/calculators/bmr";
import { calculateTdee } from "@/lib/calculators/tdee";
import { ActivityLevel } from "@/lib/calculators/types";

describe("BMR (Mifflin-St Jeor)", () => {
  it("男", () => {
    const r = calculateBmr({ sex: "male", weightKg: 70, heightCm: 175, age: 25 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bmr).toBeCloseTo(1673.75, 2);
  });
  it("女", () => {
    const r = calculateBmr({ sex: "female", weightKg: 60, heightCm: 165, age: 25 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bmr).toBeCloseTo(1345.25, 2);
  });
  it("非法输入返回错误", () => {
    const r = calculateBmr({ sex: "male", weightKg: 0, heightCm: 175, age: 25 });
    expect(r.ok).toBe(false);
  });
});

describe("TDEE", () => {
  it("中度活动", () => {
    const r = calculateTdee({ bmr: 1673.75, activityLevel: ActivityLevel.MODERATE });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.tdee).toBeCloseTo(2594.31, 2);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/calculators/bmr'`

- [ ] **步骤 3：创建 bmr.ts**

```ts
import { z } from "zod";
import { parseResult } from "./result";

export const bmrInputSchema = z.object({
  sex: z.enum(["male", "female"], { message: "请选择性别" }),
  weightKg: z.number().min(30, "体重需 ≥ 30kg").max(300, "体重需 ≤ 300kg"),
  heightCm: z.number().min(100, "身高需 ≥ 100cm").max(250, "身高需 ≤ 250cm"),
  age: z.number().int().min(10, "年龄需 ≥ 10").max(100, "年龄需 ≤ 100"),
});

export type BmrInput = z.infer<typeof bmrInputSchema>;
export interface BmrOutput {
  bmr: number;
}

export function calculateBmr(input: unknown) {
  const parsed = parseResult(bmrInputSchema, input);
  if (!parsed.ok) return parsed;
  const { sex, weightKg, heightCm, age } = parsed.data;
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  const bmr = sex === "male" ? base + 5 : base - 161;
  return { ok: true, data: { bmr } } as const;
}
```

- [ ] **步骤 4：创建 tdee.ts**

```ts
import { z } from "zod";
import { parseResult } from "./result";
import { ActivityLevel, ACTIVITY_FACTORS } from "./types";

export const tdeeInputSchema = z.object({
  bmr: z.number().positive("BMR 需为正数"),
  activityLevel: z.nativeEnum(ActivityLevel, { message: "请选择活动水平" }),
});

export type TdeeInput = z.infer<typeof tdeeInputSchema>;
export interface TdeeOutput {
  tdee: number;
  activityFactor: number;
}

export function calculateTdee(input: unknown) {
  const parsed = parseResult(tdeeInputSchema, input);
  if (!parsed.ok) return parsed;
  const { bmr, activityLevel } = parsed.data;
  const activityFactor = ACTIVITY_FACTORS[activityLevel];
  const tdee = bmr * activityFactor;
  return { ok: true, data: { tdee, activityFactor } } as const;
}
```

- [ ] **步骤 5：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 6：Commit**

```bash
git add src/lib/calculators/bmr.ts src/lib/calculators/tdee.ts src/lib/calculators/__tests__/bmr-tdee.test.ts
git commit -m "feat: add bmr and tdee calculators"
```

---

## 任务 4：体脂率（美国海军法）

**文件：**
- 创建：`src/lib/calculators/bodyFat.ts`
- 测试：`src/lib/calculators/__tests__/bodyFat.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { calculateBodyFat } from "@/lib/calculators/bodyFat";

describe("bodyFat (Navy Method)", () => {
  it("男", () => {
    const r = calculateBodyFat({ sex: "male", heightCm: 170, neckCm: 40, waistCm: 80 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bodyFatPct).toBeCloseTo(11.96, 2);
  });
  it("女", () => {
    const r = calculateBodyFat({ sex: "female", heightCm: 160, neckCm: 34, waistCm: 70, hipCm: 95 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.bodyFatPct).toBeGreaterThan(0);
    expect(r.ok && r.data.bodyFatPct).toBeLessThan(60);
  });
  it("腰围不大于颈围（男）返回错误", () => {
    const r = calculateBodyFat({ sex: "male", heightCm: 170, neckCm: 90, waistCm: 80 });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/calculators/bodyFat'`

- [ ] **步骤 3：创建 bodyFat.ts**

```ts
import { z } from "zod";
import { parseResult } from "./result";

const range = { min: 20, max: 120 } as const;

export const bodyFatInputSchema = z
  .object({
    sex: z.enum(["male", "female"], { message: "请选择性别" }),
    heightCm: z.number().min(100, "身高需 ≥ 100cm").max(250, "身高需 ≤ 250cm"),
    neckCm: z.number().min(range.min).max(range.max),
    waistCm: z.number().min(range.min).max(range.max),
    hipCm: z.number().min(range.min).max(range.max).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.sex === "male") {
      if (v.waistCm <= v.neckCm) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["waistCm"], message: "腰围需大于颈围" });
      }
    } else {
      if (!v.hipCm) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hipCm"], message: "女性需填写臀围" });
      } else if (v.waistCm + v.hipCm <= v.neckCm) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["waistCm"], message: "腰围+臀围需大于颈围" });
      }
    }
  });

export type BodyFatInput = z.infer<typeof bodyFatInputSchema>;
export interface BodyFatOutput {
  bodyFatPct: number;
}

export function calculateBodyFat(input: unknown) {
  const parsed = parseResult(bodyFatInputSchema, input);
  if (!parsed.ok) return parsed;
  const { sex, heightCm, neckCm, waistCm, hipCm } = parsed.data;

  const log10 = (n: number) => Math.log10(n);
  let bodyFatPct: number;
  if (sex === "male") {
    const denom = 1.0324 - 0.19077 * log10(waistCm - neckCm) + 0.15456 * log10(heightCm);
    bodyFatPct = 495 / denom - 450;
  } else {
    const denom = 1.29579 - 0.35004 * log10(waistCm + hipCm! - neckCm) + 0.221 * log10(heightCm);
    bodyFatPct = 495 / denom - 450;
  }
  return { ok: true, data: { bodyFatPct } } as const;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/calculators/bodyFat.ts src/lib/calculators/__tests__/bodyFat.test.ts
git commit -m "feat: add body fat calculator (navy method)"
```

---

## 任务 5：宏量营养

**文件：**
- 创建：`src/lib/calculators/macros.ts`
- 测试：`src/lib/calculators/__tests__/macros.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { calculateMacros } from "@/lib/calculators/macros";

describe("macros", () => {
  it("减脂", () => {
    const r = calculateMacros({ tdee: 2500, weightKg: 70, goal: "cut" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.calories).toBeCloseTo(2000, 2);
      expect(r.data.proteinG).toBeCloseTo(154, 2);
      expect(r.data.fatG).toBeCloseTo(55.56, 2);
      expect(r.data.carbsG).toBeCloseTo(221, 2);
    }
  });
  it("高级设置覆盖", () => {
    const r = calculateMacros({ tdee: 2500, weightKg: 70, goal: "cut", overrides: { calorieFactor: 0.9 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.calories).toBeCloseTo(2250, 2);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/calculators/macros'`

- [ ] **步骤 3：创建 macros.ts**

```ts
import { z } from "zod";
import { parseResult } from "./result";
import { Goal, MACRO_DEFAULTS } from "./types";

export const macrosInputSchema = z.object({
  tdee: z.number().positive("TDEE 需为正数"),
  weightKg: z.number().min(30).max(300),
  goal: z.nativeEnum(Goal, { message: "请选择目标" }),
  overrides: z
    .object({
      calorieFactor: z.number().min(0.5).max(1.5).optional(),
      proteinPerKg: z.number().min(0.8).max(3.5).optional(),
      fatRatio: z.number().min(0.15).max(0.4).optional(),
    })
    .optional(),
});

export type MacrosInput = z.infer<typeof macrosInputSchema>;
export interface MacrosOutput {
  calories: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export function calculateMacros(input: unknown) {
  const parsed = parseResult(macrosInputSchema, input);
  if (!parsed.ok) return parsed;
  const { tdee, weightKg, goal, overrides } = parsed.data;

  const calorieFactor = overrides?.calorieFactor ?? MACRO_DEFAULTS.calorieFactor[goal];
  const proteinPerKg = overrides?.proteinPerKg ?? MACRO_DEFAULTS.proteinPerKg[goal];
  const fatRatio = overrides?.fatRatio ?? MACRO_DEFAULTS.fatRatio;

  const calories = tdee * calorieFactor;
  const proteinG = proteinPerKg * weightKg;
  const proteinKcal = proteinG * 4;
  const fatKcal = calories * fatRatio;
  const fatG = fatKcal / 9;
  const carbsG = Math.max(0, (calories - proteinKcal - fatKcal) / 4);

  return { ok: true, data: { calories, proteinG, fatG, carbsG } } as const;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/calculators/macros.ts src/lib/calculators/__tests__/macros.test.ts
git commit -m "feat: add macros calculator"
```

---

## 任务 6：FFMI

**文件：**
- 创建：`src/lib/calculators/ffmi.ts`
- 测试：`src/lib/calculators/__tests__/ffmi.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { calculateFfmi } from "@/lib/calculators/ffmi";

describe("FFMI", () => {
  it("含标准化修正", () => {
    const r = calculateFfmi({ weightKg: 80, heightCm: 180, bodyFatPct: 15 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.leanMassKg).toBeCloseTo(68, 2);
      expect(r.data.ffmi).toBeCloseTo(20.99, 2);
      expect(r.data.adjustedFfmi).toBeCloseTo(20.99, 2);
    }
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/calculators/ffmi'`

- [ ] **步骤 3：创建 ffmi.ts**

```ts
import { z } from "zod";
import { parseResult } from "./result";

export const ffmiInputSchema = z.object({
  weightKg: z.number().min(30).max(300),
  heightCm: z.number().min(100).max(250),
  bodyFatPct: z.number().min(2).max(60, "体脂率需在 2-60%"),
});

export type FfmiInput = z.infer<typeof ffmiInputSchema>;
export interface FfmiOutput {
  leanMassKg: number;
  ffmi: number;
  adjustedFfmi: number;
}

export function calculateFfmi(input: unknown) {
  const parsed = parseResult(ffmiInputSchema, input);
  if (!parsed.ok) return parsed;
  const { weightKg, heightCm, bodyFatPct } = parsed.data;

  const heightM = heightCm / 100;
  const leanMassKg = weightKg * (1 - bodyFatPct / 100);
  const ffmi = leanMassKg / (heightM * heightM);
  const adjustedFfmi = ffmi + 6.1 * (1.8 - heightM);

  return { ok: true, data: { leanMassKg, ffmi, adjustedFfmi } } as const;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/calculators/ffmi.ts src/lib/calculators/__tests__/ffmi.test.ts
git commit -m "feat: add ffmi calculator"
```

---

## 任务 7：1RM

**文件：**
- 创建：`src/lib/calculators/oneRm.ts`
- 测试：`src/lib/calculators/__tests__/oneRm.test.ts`

- [ ] **步骤 1：编写失败测试**

```ts
import { describe, it, expect } from "vitest";
import { calculateOneRm } from "@/lib/calculators/oneRm";

describe("1RM", () => {
  it("Epley 与 Brzycki", () => {
    const r = calculateOneRm({ weightKg: 100, reps: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.epley).toBeCloseTo(116.67, 2);
      expect(r.data.brzycki).toBeCloseTo(112.5, 2);
    }
  });
  it("次数超范围返回错误", () => {
    const r = calculateOneRm({ weightKg: 100, reps: 0 });
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：`npm test`
预期：FAIL，报错 `Cannot find module '@/lib/calculators/oneRm'`

- [ ] **步骤 3：创建 oneRm.ts**

```ts
import { z } from "zod";
import { parseResult } from "./result";

export const oneRmInputSchema = z.object({
  weightKg: z.number().min(1).max(1000, "重量需 > 0"),
  reps: z.number().int().min(1, "次数需 ≥ 1").max(30, "次数需 ≤ 30"),
});

export type OneRmInput = z.infer<typeof oneRmInputSchema>;
export interface OneRmOutput {
  epley: number;
  brzycki: number;
}

export function calculateOneRm(input: unknown) {
  const parsed = parseResult(oneRmInputSchema, input);
  if (!parsed.ok) return parsed;
  const { weightKg, reps } = parsed.data;

  const epley = weightKg * (1 + reps / 30);
  const brzycki = (weightKg * 36) / (37 - reps);

  return { ok: true, data: { epley, brzycki } } as const;
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：`npm test`
预期：PASS

- [ ] **步骤 5：Commit**

```bash
git add src/lib/calculators/oneRm.ts src/lib/calculators/__tests__/oneRm.test.ts
git commit -m "feat: add 1rm calculator"
```

---

## 任务 8：统一导出 + 全量测试

**文件：**
- 创建：`src/lib/calculators/index.ts`

- [ ] **步骤 1：创建 index.ts**

```ts
export * from "./types";
export * from "./result";
export * from "./bmr";
export * from "./tdee";
export * from "./bodyFat";
export * from "./macros";
export * from "./ffmi";
export * from "./oneRm";
```

- [ ] **步骤 2：运行全量测试**

运行：`npm test`
预期：全部 PASS（7 个测试文件）

- [ ] **步骤 3：运行 lint 与 build**

```bash
npm run lint && npm run build
```

预期：lint 无错误，build 成功

- [ ] **步骤 4：Commit**

```bash
git add src/lib/calculators/index.ts
git commit -m "feat: add calculators barrel export"
```

---

## 任务 9：UI 导航页 + 共享组件

**文件：**
- 创建：`src/app/calculators/page.tsx`
- 创建：`src/components/calculators/ResultField.tsx`
- 创建：`src/components/calculators/NumberField.tsx`

- [ ] **步骤 1：创建导航页 `src/app/calculators/page.tsx`**

```tsx
import Link from "next/link";

const items = [
  { href: "/calculators/bmr", name: "BMR / TDEE", desc: "基础代谢与每日总代谢" },
  { href: "/calculators/body-fat", name: "体脂率", desc: "美国海军体脂测量法" },
  { href: "/calculators/macros", name: "宏量营养", desc: "减脂/增肌/维持每日摄入" },
  { href: "/calculators/ffmi", name: "FFMI", desc: "去脂体重指数" },
  { href: "/calculators/one-rm", name: "1RM", desc: "最大重量估算" },
];

export default function CalculatorsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-8 text-3xl font-semibold">健身计算器</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="rounded-xl border border-zinc-200 p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
          >
            <div className="text-lg font-medium">{it.name}</div>
            <div className="mt-1 text-sm text-zinc-500">{it.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **步骤 2：创建 `src/components/calculators/NumberField.tsx`**

```tsx
"use client";

interface Props {
  label: string;
  unit?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  step?: string;
}

export function NumberField({ label, unit, value, onChange, error, step = "0.1" }: Props) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="number"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        {unit && <span className="text-sm text-zinc-500">{unit}</span>}
      </div>
      {error && <span className="mt-1 block text-sm text-red-500">{error}</span>}
    </label>
  );
}
```

- [ ] **步骤 3：创建 `src/components/calculators/ResultField.tsx`**

```tsx
interface Props {
  label: string;
  value: string;
  hint?: string;
}

export function ResultField({ label, value, hint }: Props) {
  return (
    <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-400">{hint}</div>}
    </div>
  );
}
```

- [ ] **步骤 4：验证**

运行：`npm run build`
预期：build 成功，`/calculators` 路由生成

- [ ] **步骤 5：Commit**

```bash
git add src/app/calculators/page.tsx src/components/calculators/
git commit -m "feat: add calculators navigation and shared components"
```

---

## 任务 10：五个计算器页面

**文件（均为「use client」页面）：**
- 创建：`src/app/calculators/bmr/page.tsx`
- 创建：`src/app/calculators/body-fat/page.tsx`
- 创建：`src/app/calculators/macros/page.tsx`
- 创建：`src/app/calculators/ffmi/page.tsx`
- 创建：`src/app/calculators/one-rm/page.tsx`

每个页面遵循同一模式：`useState` 持有字符串输入 → 提交时 `Number()` 转数字 → 调用对应 `calculateX` → 成功渲染 `ResultField`，失败展示 `errors`。

- [ ] **步骤 1：创建 `src/app/calculators/bmr/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { calculateBmr, calculateTdee, ActivityLevel, ACTIVITY_FACTORS } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function BmrPage() {
  const [sex, setSex] = useState("male");
  const [weightKg, setWeightKg] = useState("70");
  const [heightCm, setHeightCm] = useState("175");
  const [age, setAge] = useState("25");
  const [activity, setActivity] = useState<ActivityLevel>(ActivityLevel.MODERATE);
  const [result, setResult] = useState<{ bmr: number; tdee: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bmrRes = calculateBmr({ sex, weightKg: Number(weightKg), heightCm: Number(heightCm), age: Number(age) });
    if (!bmrRes.ok) return setErrors(bmrRes.errors);
    const tdeeRes = calculateTdee({ bmr: bmrRes.data.bmr, activityLevel: activity });
    if (!tdeeRes.ok) return setErrors(tdeeRes.errors);
    setErrors({});
    setResult({ bmr: bmrRes.data.bmr, tdee: tdeeRes.data.tdee });
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">BMR / TDEE 计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex gap-4">
          <label className="flex items-center gap-2">
            <input type="radio" checked={sex === "male"} onChange={() => setSex("male")} /> 男
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={sex === "female"} onChange={() => setSex("female")} /> 女
          </label>
        </div>
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="身高" unit="cm" value={heightCm} onChange={setHeightCm} error={errors.heightCm} />
        <NumberField label="年龄" unit="岁" value={age} onChange={setAge} error={errors.age} step="1" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">活动水平</span>
          <select
            value={activity}
            onChange={(e) => setActivity(e.target.value as ActivityLevel)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {Object.entries(ACTIVITY_FACTORS).map(([k]) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ResultField label="基础代谢 BMR" value={`${result.bmr.toFixed(0)} kcal/天`} />
          <ResultField label="每日总代谢 TDEE" value={`${result.tdee.toFixed(0)} kcal/天`} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 2：创建 `src/app/calculators/body-fat/page.tsx`**

```tsx
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
```

- [ ] **步骤 3：创建 `src/app/calculators/macros/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { calculateMacros, Goal } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function MacrosPage() {
  const [weightKg, setWeightKg] = useState("70");
  const [tdee, setTdee] = useState("2500");
  const [goal, setGoal] = useState<Goal>(Goal.CUT);
  const [result, setResult] = useState<{ calories: number; proteinG: number; fatG: number; carbsG: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = calculateMacros({ tdee: Number(tdee), weightKg: Number(weightKg), goal });
    if (!res.ok) return setErrors(res.errors);
    setErrors({});
    setResult(res.data);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">宏量营养计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="每日总代谢 TDEE" unit="kcal" value={tdee} onChange={setTdee} error={errors.tdee} />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">目标</span>
          <select
            value={goal}
            onChange={(e) => setGoal(e.target.value as Goal)}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value={Goal.CUT}>减脂</option>
            <option value={Goal.BULK}>增肌</option>
            <option value={Goal.MAINTAIN}>维持</option>
          </select>
        </label>
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ResultField label="每日总热量" value={`${result.calories.toFixed(0)} kcal`} />
          <ResultField label="蛋白质" value={`${result.proteinG.toFixed(0)} g`} />
          <ResultField label="脂肪" value={`${result.fatG.toFixed(0)} g`} />
          <ResultField label="碳水" value={`${result.carbsG.toFixed(0)} g`} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 4：创建 `src/app/calculators/ffmi/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { calculateFfmi } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function FfmiPage() {
  const [weightKg, setWeightKg] = useState("80");
  const [heightCm, setHeightCm] = useState("180");
  const [bodyFatPct, setBodyFatPct] = useState("15");
  const [result, setResult] = useState<{ leanMassKg: number; ffmi: number; adjustedFfmi: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = calculateFfmi({ weightKg: Number(weightKg), heightCm: Number(heightCm), bodyFatPct: Number(bodyFatPct) });
    if (!res.ok) return setErrors(res.errors);
    setErrors({});
    setResult(res.data);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">FFMI 计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="身高" unit="cm" value={heightCm} onChange={setHeightCm} error={errors.heightCm} />
        <NumberField label="体脂率" unit="%" value={bodyFatPct} onChange={setBodyFatPct} error={errors.bodyFatPct} />
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3">
          <ResultField label="瘦体重" value={`${result.leanMassKg.toFixed(1)} kg`} />
          <ResultField label="FFMI" value={result.ffmi.toFixed(2)} />
          <ResultField label="标准化 FFMI" value={result.adjustedFfmi.toFixed(2)} hint="按身高 1.8m 标准化" />
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 5：创建 `src/app/calculators/one-rm/page.tsx`**

```tsx
"use client";

import { useState } from "react";
import { calculateOneRm } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";
import { ResultField } from "@/components/calculators/ResultField";

export default function OneRmPage() {
  const [weightKg, setWeightKg] = useState("100");
  const [reps, setReps] = useState("5");
  const [result, setResult] = useState<{ epley: number; brzycki: number } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = calculateOneRm({ weightKg: Number(weightKg), reps: Number(reps) });
    if (!res.ok) return setErrors(res.errors);
    setErrors({});
    setResult(res.data);
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">1RM 计算器</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <NumberField label="重量" unit="kg" value={weightKg} onChange={setWeightKg} error={errors.weightKg} />
        <NumberField label="次数" unit="次" value={reps} onChange={setReps} error={errors.reps} step="1" />
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">
          计算
        </button>
      </form>
      {result && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <ResultField label="1RM（Epley）" value={`${result.epley.toFixed(1)} kg`} />
          <ResultField label="1RM（Brzycki）" value={`${result.brzycki.toFixed(1)} kg`} />
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 6：更新首页跳转**

修改 `src/app/page.tsx`：将默认 Next.js 欢迎内容替换为指向 `/calculators` 的入口。

```tsx
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-semibold">智能健身助手</h1>
      <p className="mt-3 text-zinc-500">身体代谢 · 体脂 · 营养 · 训练计算</p>
      <Link
        href="/calculators"
        className="mt-8 rounded-lg bg-zinc-900 px-6 py-3 text-white dark:bg-white dark:text-black"
      >
        进入计算器
      </Link>
    </div>
  );
}
```

- [ ] **步骤 7：验证**

运行：`npm run lint && npm run build`
预期：lint 无错误，build 成功，生成 `/calculators`、`/calculators/bmr`、`/calculators/body-fat`、`/calculators/macros`、`/calculators/ffmi`、`/calculators/one-rm` 路由

- [ ] **步骤 8：Commit**

```bash
git add src/app/ src/components/calculators/
git commit -m "feat: add calculator pages"
```

---

## 任务 11：集成验证与收尾

- [ ] **步骤 1：全量测试 + lint + build**

```bash
npm test && npm run lint && npm run build
```

预期：全部通过

- [ ] **步骤 2：手动冒烟验证**

运行：`npm run dev`，浏览器访问 `http://localhost:3000/calculators`，逐个计算器输入样例并确认结果正确、非法输入显示中文错误。

- [ ] **步骤 3：Commit 并推送**

```bash
git push
```

---

## 自检记录

- **规格覆盖度**：规格中的 6 个计算模块（任务 3-7）、zod 校验（各任务 schema）、Vitest（任务 1-8）、导航（任务 9）、独立页（任务 10）、高级设置（macros 的 overrides）均已覆盖。
- **占位符**：无 TODO/待定，每个代码步骤含完整代码。
- **类型一致性**：`parseResult` 返回 `Result<T>`，各 `calculateX` 统一 `{ ok, data } | { ok, errors }` 结构；`ResultField`/`NumberField` 组件 props 与页面调用一致。

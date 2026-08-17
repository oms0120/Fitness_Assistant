# 收尾遗留 Minor 实现计划

> **面向 AI 代理的工作者：** 使用 superpowers:subagent-driven-development 逐任务实现。

**目标：** 修复 4 个遗留 Minor：历史页格式化、档案页预填、配餐边界提示、.env.example。

**技术栈：** Next.js 16、TypeScript、vitest。

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `src/lib/logFormat.ts` | 按 type 格式化 Log.data 为可读中文 |
| `src/lib/__tests__/logFormat.test.ts` | 格式化单测 |
| `src/app/history/page.tsx` | 用 formatLogData 替换原始 JSON 显示 |
| `src/app/profile/profile-client.tsx` | GET 加载 + 预填最近档案 |
| `src/app/meals/meals-client.tsx` | 配餐 null 提示 + 清空旧结果 |
| `.env.example` | 记录 DATABASE_URL/AUTH_SECRET |

---

## 任务 1：历史页格式化

**文件：** 创建 `src/lib/logFormat.ts`、`src/lib/__tests__/logFormat.test.ts`；修改 `src/app/history/page.tsx`

- [ ] **步骤 1：先 Read `src/app/history/page.tsx` 了解现有 data 展示**

- [ ] **步骤 2：创建 logFormat.ts**

```ts
export function formatLogData(type: string, raw: string): string {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    return raw;
  }
  const n = (v: unknown, digits = 0) => (typeof v === "number" ? v.toFixed(digits) : String(v ?? "-"));
  switch (type) {
    case "bmr":
      return `BMR ${n(data.bmr)} kcal · TDEE ${n(data.tdee)} kcal`;
    case "bodyfat":
      return `体脂率 ${n(data.bodyFatPct, 1)}%`;
    case "macros":
      return `热量 ${n(data.calories)} kcal · 蛋白 ${n(data.proteinG)}g · 碳水 ${n(data.carbsG)}g · 脂肪 ${n(data.fatG)}g`;
    case "ffmi":
      return `FFMI ${n(data.ffmi, 2)} · 标准化 ${n(data.adjustedFfmi, 2)} · 瘦体重 ${n(data.leanMassKg, 1)}kg`;
    case "onerm":
      return `1RM ${n(data.epley, 1)}kg (Epley) / ${n(data.brzycki, 1)}kg (Brzycki)`;
    default:
      return raw;
  }
}
```

- [ ] **步骤 3：创建单测 logFormat.test.ts**

```ts
import { describe, it, expect } from "vitest";
import { formatLogData } from "@/lib/logFormat";

describe("formatLogData", () => {
  it("bmr", () => {
    expect(formatLogData("bmr", JSON.stringify({ bmr: 1673.75, tdee: 2594.31 }))).toBe("BMR 1674 kcal · TDEE 2594 kcal");
  });
  it("bodyfat", () => {
    expect(formatLogData("bodyfat", JSON.stringify({ bodyFatPct: 15.2 }))).toBe("体脂率 15.2%");
  });
  it("macros", () => {
    expect(formatLogData("macros", JSON.stringify({ calories: 2000, proteinG: 154, carbsG: 221, fatG: 55.6 }))).toBe("热量 2000 kcal · 蛋白 154g · 碳水 221g · 脂肪 56g");
  });
  it("非法 JSON 返回原文", () => {
    expect(formatLogData("bmr", "not-json")).toBe("not-json");
  });
});
```

- [ ] **步骤 4：修改 history 页用 formatLogData**

把 `{l.data}` 替换为 `{formatLogData(l.type, l.data)}`。

- [ ] **步骤 5：验证 + Commit**

```bash
npm test && npm run lint && npm run build
git add src/lib/logFormat.ts src/lib/__tests__/logFormat.test.ts src/app/history/page.tsx
git commit -m "feat: format history log data"
```

---

## 任务 2：档案页预填

**文件：** 修改 `src/app/profile/profile-client.tsx`

- [ ] **步骤 1：先 Read `src/app/profile/profile-client.tsx`**

- [ ] **步骤 2：加载并预填最近档案**

在 ProfileClient 加一个 `useEffect`，GET `/api/profile`，若有 `profiles[0]` 则用其字段预填各 useState：

```tsx
useEffect(() => {
  (async () => {
    const res = await fetch("/api/profile");
    if (!res.ok) return;
    const data = await res.json();
    const p = data.profiles?.[0];
    if (!p) return;
    setSex(p.sex);
    setHeightCm(String(p.heightCm));
    setWeightKg(String(p.weightKg));
    setNeckCm(String(p.neckCm));
    setWaistCm(String(p.waistCm));
    if (p.hipCm != null) setHipCm(String(p.hipCm));
    setAge(String(p.age));
    setGoal(p.goal);
    setActivity(p.activity);
  })();
}, []);
```

- [ ] **步骤 3：验证 + Commit**

```bash
npm run lint && npm run build
git add src/app/profile/profile-client.tsx
git commit -m "feat: prefill profile from latest record"
```

---

## 任务 3：配餐边界提示 + .env.example

**文件：** 修改 `src/app/meals/meals-client.tsx`；创建 `.env.example`

- [ ] **步骤 1：先 Read `src/app/meals/meals-client.tsx` 的配餐区块**

- [ ] **步骤 2：配餐 null 提示 + 清空旧结果**

在 `onPlanSubmit` 里：
- 校验失败时先 `setMealPlan(null)` 再 return
- `findMealPlan` 返回 null 时设置一个提示（如 `setPlanError("未找到合适组合，请调整热量或比例")`）
- 加 `planError` state 展示提示，成功时清空

```tsx
function onPlanSubmit(e: React.FormEvent) {
  e.preventDefault();
  setPlanError("");
  const kcal = Number(planCalories);
  if (!Number.isFinite(kcal) || kcal <= 0) { setMealPlan(null); return; }
  const sum = carbPct + proteinPct + fatPct;
  if (sum <= 0) { setMealPlan(null); return; }
  const result = findMealPlan({
    targetCalories: kcal,
    carbRatio: carbPct / sum,
    proteinRatio: proteinPct / sum,
    fatRatio: fatPct / sum,
  });
  setMealPlan(result);
  if (!result) setPlanError("未找到合适组合，请调整热量或比例");
}
```

- [ ] **步骤 3：创建 .env.example**

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="replace-with-a-random-secret"
```

- [ ] **步骤 4：验证 + Commit + push**

```bash
npm run lint && npm run build
git add src/app/meals/meals-client.tsx .env.example
git commit -m "fix: meal plan boundary feedback and env example"
git push
```

---

## 自检记录

- 4 项全部覆盖：历史页格式化（任务 1）、档案预填（任务 2）、配餐边界 + .env.example（任务 3）。
- 格式化数值用 `toFixed` 取整（BMR/TDEE/热量取 0 位小数，体脂 1 位，FFMI 2 位）。
- 档案预填字段与 Profile schema 对应（hipCm 可选需判 `!= null`）。

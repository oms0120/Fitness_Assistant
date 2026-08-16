# 阶段 1 设计：核心计算器

> 日期：2026-08-16
> 状态：已确认

## Context

智能健身助手的第一批可交付功能 —— 6 个确定性计算器（BMR/TDEE、体脂率、宏量营养、FFMI、1RM）。这些是纯计算，无需登录、无需持久化（阶段 3 才做账户与历史）。目标是先跑通核心价值，并以可测试、可复用的纯函数落地，为后续阶段打基础。

## 范围

- 6 个计算器，独立路由页面
- 计算逻辑为纯函数，zod 校验输入
- Vitest 单测锁定公式正确性
- 不做英制单位、不做登录、不做历史保存（后续阶段）

## 已确认决策

- 参数控制：默认科学推荐值 + 可展开「高级设置」微调
- 导航：首页卡片网格 + 各计算器独立页
- 营养目标：减脂 / 增肌 / 维持 三种
- 单位：公制 kg/cm
- 1RM：Epley + Brzycki 双公式都显示

## 架构方案

纯函数库 + 客户端即时计算。计算逻辑集中在 `src/lib/calculators/`，React 客户端组件 import 纯函数，输入即算。纯函数无副作用，阶段 3 持久化时服务端可复用同一套函数。

## 目录结构

```
src/lib/calculators/
  types.ts          # Sex / Goal / ActivityLevel 枚举与共享类型
  bmr.ts            # Mifflin-St Jeor
  tdee.ts           # BMR × 活动系数
  bodyFat.ts        # 美国海军体脂法
  macros.ts         # 减脂/增肌/维持宏量营养
  ffmi.ts           # FFMI + 标准化修正
  oneRm.ts          # Epley + Brzycki
  index.ts          # 统一导出
src/lib/calculators/__tests__/   # Vitest 单测
src/app/calculators/             # 计算器卡片网格导航页
  bmr/page.tsx  body-fat/page.tsx  macros/page.tsx  ffmi/page.tsx  one-rm/page.tsx
src/components/calculators/      # 共享表单/结果组件
```

## 核心计算模块

### bmr.ts（基础代谢）
Mifflin-St Jeor 公式：
- 男：`10×体重(kg) + 6.25×身高(cm) − 5×年龄 + 5`
- 女：`10×体重(kg) + 6.25×身高(cm) − 5×年龄 − 161`

输入：`{ sex, weightKg, heightCm, age }` → 输出 `{ bmr }`

### tdee.ts（每日总代谢）
`TDEE = BMR × 活动系数`

活动系数（集中常量化于 `types.ts`）：
| 档位 | 系数 | 说明 |
|---|---|---|
| SEDENTARY | 1.2 | 久坐、几乎不运动 |
| LIGHT | 1.375 | 每周运动 1–3 次 |
| MODERATE | 1.55 | 每周运动 3–5 次 |
| HIGH | 1.725 | 每周运动 6–7 次 |
| EXTREME | 1.9 | 高强度体力劳动/每日多训 |

输入：`{ bmr, activityLevel }` → 输出 `{ tdee, activityFactor }`

### bodyFat.ts（美国海军体脂法，cm 单位）
- 男：`495 / (1.0324 − 0.19077×log10(腰围−颈围) + 0.15456×log10(身高)) − 450`
- 女：`495 / (1.29579 − 0.35004×log10(腰围+臀围−颈围) + 0.22100×log10(身高)) − 450`

输入：`{ sex, heightCm, neckCm, waistCm, hipCm?(女必填) }`
输出：`{ bodyFatPct }`。瘦体重/脂肪重是派生值，由 UI 用 `体重 × (1−体脂率)` 计算展示，不单独成函数（ffmi.ts 内部复用同一换算）。

校验：腰围须 > 颈围（男）、腰围+臀围须 > 颈围（女），否则 log10 入参 ≤ 0 产生 NaN，zod 拦截并返回错误。

### macros.ts（宏量营养）
热量目标（默认值，高级设置可调）：
- 减脂 CUT：`TDEE × 0.80`（缺口 20%）
- 增肌 BULK：`TDEE × 1.10`（盈余 10%）
- 维持 MAINTAIN：`TDEE × 1.00`

宏量（默认值，高级设置可调）：
- 蛋白质：减脂 2.2 g/kg、增肌/维持 1.8 g/kg
- 脂肪：总热量 25%
- 碳水：剩余热量 ÷ 4（蛋白 4 kcal/g、碳水 4 kcal/g、脂肪 9 kcal/g）

输入：`{ tdee, weightKg, goal, overrides? }` → 输出 `{ calories, proteinG, fatG, carbsG }`
其中 `overrides`（高级设置）可覆盖 `{ calorieFactor?（热量系数）, proteinPerKg?（蛋白 g/kg）, fatRatio?（脂肪占比）}`。

### ffmi.ts（去脂体重指数）
- 瘦体重 = `体重 × (1 − 体脂率/100)`
- FFMI = `瘦体重 / 身高(m)²`
- 标准化 FFMI = `FFMI + 6.1 × (1.8 − 身高m)`

输入：`{ weightKg, heightCm, bodyFatPct }` → 输出 `{ ffmi, adjustedFfmi, leanMassKg }`

### oneRm.ts（1RM 估算）
- Epley：`重量 × (1 + 次数/30)`
- Brzycki：`重量 × 36 / (37 − 次数)`

输入：`{ weightKg, reps }` → 输出 `{ epley, brzycki }`
校验：`1 ≤ reps ≤ 30`（Brzycki 在 reps=37 时分母为 0，上限 30 保证有效）。

## 输入校验（zod）

每个模块配独立 zod schema，超范围输入返回结构化错误，不抛异常：
- 身高 100–250 cm、体重 30–300 kg、年龄 10–100、颈/腰/臀围 20–120 cm
- 次数 1–30

## 数据流

用户输入 → zod 校验（失败展示行内错误）→ 纯函数计算 → 结果卡片展示。计算在浏览器端即时完成，无 API 调用、无 loading 态。

## 错误处理

- zod 校验失败：返回 `{ ok: false, errors }`，UI 在对应字段显示中文错误提示
- 校验通过：返回 `{ ok: true, data }`，渲染结果

## 测试策略（Vitest）

每个模块用已知样本断言：
- BMR：标准 Mifflin 用例（男女各一）
- TDEE：各活动系数档位
- 体脂率：美国海军法男女各一组
- 宏量：减脂/增肌/维持三档热量与克数
- FFMI：含标准化修正的用例
- 1RM：Epley 与 Brzycki 已知值

## UI 设计

- 首页 `src/app/calculators/page.tsx`：卡片网格，6 个计算器入口（图标 + 名称 + 一句话说明）
- 各计算器页：表单（字段 + 单位标注）+「高级设置」折叠面板 + 结果卡片
- 结果卡片用 shadcn 组件 + 语义色，突出核心数值

## 非目标（YAGNI）

- 英制单位切换
- 计算历史保存
- 图表可视化（后续阶段按需）
- 移动端独立布局（响应式 CSS 即可）

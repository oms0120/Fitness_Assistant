# 组合配餐 设计

> 日期：2026-08-16
> 状态：待审查

## Context

阶段 2 的菜谱库支持单食谱热量匹配。本迭代升级为「组合配餐」：输入目标热量，系统组合早/午/晚 3 餐，使总热量与总宏量都接近目标。

## 已确认决策

- **配餐结构**：固定 3 餐（早餐 + 午餐 + 晚餐），区分餐次——早餐从 `mealType: "breakfast"` 选，午晚餐从 `mealType: "meal"` 选
- **匹配目标**：热量 + 宏量（蛋白/碳水/脂肪）多目标接近
- **宏量比例**：用户可选方案（减脂/增肌/维持）+ 手动调整比例

## 默认宏量比例（三套）

| 方案 | 碳水 | 蛋白质 | 脂肪 |
|---|---|---|---|
| 减脂 cut | 40% | 40% | 20% |
| 增肌 bulk | 50% | 30% | 20% |
| 维持 maintain | 45% | 30% | 25% |

## 数据模型

`Recipe` 加字段 `mealType: "breakfast" | "meal"`。现有 12 个菜谱标注 mealType，并补充早餐类菜谱至至少 3 个（现有仅「鸡蛋白燕麦粥」为早餐，需新增 2 个早餐菜谱）。

## 算法（`src/lib/mealPlanMatching.ts`，纯函数 + 单测）

**输入**：`{ targetCalories, carbRatio, proteinRatio, fatRatio }`（比例已归一化，和为 1）

**目标宏量推导**：
- `targetProteinG = targetCalories * proteinRatio / 4`
- `targetCarbsG = targetCalories * carbRatio / 4`
- `targetFatG = targetCalories * fatRatio / 9`

**穷举组合**：
- 早餐 ∈ breakfast 类 × 午餐 ∈ meal 类 × 晚餐 ∈ meal 类（午餐晚餐可重复同一菜谱）
- 对每个组合计算总热量、总蛋白、总碳水、总脂肪

**打分（取最小）**：
```
score = |totalCal - targetCal| / targetCal
      + |totalProtein - targetProtein| / targetProtein
      + |totalCarbs - targetCarbs| / targetCarbs
      + |totalFat - targetFat| / targetFat
```
四项等权相对误差之和。若某项目标为 0 则跳过该项（实际比例均 > 0，不会发生）。

**输出**：最优组合 `{ breakfast, lunch, dinner, totals: {calories, proteinG, carbsG, fatG}, targets, score }`

## UI

`/meals` 页加「组合配餐」区块：
- 输入：目标热量（kcal）+ 方案选择（减脂/增肌/维持，切换时填入默认比例）+ 比例输入（碳水/蛋白/脂肪 3 个百分比，可手动调整，和应为 100%）
- 结果：早餐/午餐/晚餐 3 张菜谱卡片 + 总热量/总宏量 vs 目标对比

## 复用

- 阶段 2 的 `recipes` 数据、`Recipe` 类型
- 阶段 1 的 `Goal`（cut/bulk/maintain）语义对应

## 非目标（YAGNI）

- 餐次可调（固定 3 餐）
- 一周配餐、连续多天规划
- 菜谱排重约束（午晚餐可重复同一菜谱）

# 阶段 2 设计：规则库 + 菜谱 / 动作库 / 训练计划

> 日期：2026-08-16
> 状态：待审查

## Context

阶段 1 已完成 6 个健身计算器。阶段 2 覆盖需求 4/5/6：依《中国居民膳食指南》推荐菜谱、胸肩背腿臂动作库、分部位训练动作与计划。核心是「数据 + 展示 + 轻度交互」，延续阶段 1 的纯数据 + 组件模式。

## 已确认决策

- **数据规模**：MVP 少量示例（动作 ~20 个、菜谱 ~12 个、计划 5 个部位日）
- **推荐方式**：分类浏览 + 预设模板；组合配餐后置
- **菜谱**：每个明确标注 热量 + 蛋白质 + 碳水 + 脂肪；支持「输入热量 → 匹配单食谱」（±10% 范围，按热量差排序）
- **训练计划**：可调组数/次数 + 增删动作，localStorage 本地保存（账户云同步留待阶段 3）

## 数据模型（`src/lib/data/`，静态 TS 常量）

### exercises.ts（动作库）
```ts
interface Exercise {
  id: string;
  name: string;           // 中文名，如「杠铃卧推」
  muscleGroup: MuscleGroup; // chest | shoulder | back | legs | arms
  equipment: string;      // 器械，如「杠铃」「哑铃」「自重」
  difficulty: "beginner" | "intermediate" | "advanced";
  instructions: string;   // 动作说明（中文）
}
type MuscleGroup = "chest" | "shoulder" | "back" | "legs" | "arms";
```

### recipes.ts（菜谱库）
```ts
interface Recipe {
  id: string;
  name: string;           // 中文菜名
  category: "cut" | "bulk" | "balanced"; // 减脂/增肌/均衡
  calories: number;       // 单人份估算 kcal
  proteinG: number;
  carbsG: number;
  fatG: number;
  ingredients: string[];  // 食材清单
  steps: string[];        // 做法步骤
  tags: string[];         // 如「高蛋白」「低脂」「快手」
}
```

### plans.ts（训练计划模板）
```ts
interface PlanExercise { exerciseId: string; sets: number; reps: number; }
interface PlanDay {
  id: string;
  name: string;           // 如「胸日」
  muscleGroup: MuscleGroup;
  exercises: PlanExercise[];
}
```
5 个部位日模板：胸日 / 肩日 / 背日 / 腿日 / 臂日，每动作引用 `exercises.ts` 的 id。

## 逻辑层（`src/lib/`，纯函数 + 单测）

- `matchRecipesByCalories(targetKcal, tolerance = 0.1)`：输入热量 → 返回热量在 `target ± tolerance` 内的菜谱，按 `|calories - target|` 升序排序。无匹配时返回最接近的若干（至少给出 1 个建议）。
- `filterExercisesByGroup(muscleGroup)`：动作按部位筛选。

## 页面（3 个 + 导航）

### /exercises 动作库
- 部位 tab 筛选（胸/肩/背/腿/臂）
- 动作卡片：名称、器械、难度、动作说明

### /plans 训练计划（可编辑）
- 5 个部位日 tab，每日子动作列表（名称 + 组数 × 次数）
- 编辑能力：
  - 改组数/次数（+/- 或数字输入）
  - 从动作库添加动作（选择器按部位列出动作）
  - 删除动作
  - 「保存」写入 localStorage、「重置」恢复预设模板
- 状态：`useState` 持有当前计划，`useEffect` 从 localStorage 读初始值，修改后写回
- localStorage key：`training-plans-v1`，存用户调整后的 `PlanDay[]`

### /meals 菜谱库
- 两个入口：
  1. 分类浏览（减脂/增肌/均衡 tab）
  2. 热量匹配：输入目标热量 → `matchRecipesByCalories` 推荐
- 菜谱卡片明确展示 **热量 / 蛋白质 / 碳水 / 脂肪**（单位 kcal / g）+ 食材 + 步骤 + 标签

### 导航
首页从单一「进入计算器」改为多入口卡片网格：计算器 / 动作库 / 训练计划 / 菜谱。

## 约定

- 菜谱热量/宏量为**单人份估算值**（按常见食材营养数据），页面标注「估算，供参考」
- 训练计划组数/次数为通用推荐值，可自行调整
- 单位延续公制（g / kcal）

## 非目标（YAGNI）

- 组合配餐（多餐组合达到总热量）—— 后置
- 账户云同步训练计划 —— 阶段 3
- 菜谱/动作的用户自定义录入、图片、收藏
- 训练动作的图片/视频演示

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

export const ACTIVITY_LEVEL_LABELS: Record<ActivityLevel, string> = {
  [ActivityLevel.SEDENTARY]: "久坐（几乎不运动）",
  [ActivityLevel.LIGHT]: "轻度（每周 1–3 次）",
  [ActivityLevel.MODERATE]: "中度（每周 3–5 次）",
  [ActivityLevel.HIGH]: "高强度（每周 6–7 次）",
  [ActivityLevel.EXTREME]: "极高强度（每日多训）",
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

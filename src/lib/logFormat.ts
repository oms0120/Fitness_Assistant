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

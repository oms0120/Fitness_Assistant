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

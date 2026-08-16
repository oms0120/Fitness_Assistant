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

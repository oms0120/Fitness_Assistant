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
  it("非 1.8m 身高含标准化修正", () => {
    const r = calculateFfmi({ weightKg: 80, heightCm: 170, bodyFatPct: 15 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.ffmi).toBeCloseTo(23.53, 2);
      expect(r.data.adjustedFfmi).toBeCloseTo(24.14, 2);
      expect(r.data.adjustedFfmi).toBeGreaterThan(r.data.ffmi);
    }
  });
});

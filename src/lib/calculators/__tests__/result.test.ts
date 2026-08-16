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

import { describe, expect, it } from "vitest";
import { decideBudget, startOfDay, type BudgetLimits, type BudgetState } from "@/lib/ai/usage";

const LIMITS: BudgetLimits = { callLimit: 50, tokenLimit: 1_000 };
const state = (calls: number, tokens: number): BudgetState => ({ calls, tokens });

describe("decideBudget", () => {
  it("两个维度都没到就放行", () => {
    expect(decideBudget(state(49, 999), LIMITS)).toEqual({ ok: true });
  });

  it("刚好等于上限就拦——limit 的含义是「最多这么多次」，不是「到了再拦下一次」", () => {
    expect(decideBudget(state(50, 0), LIMITS)).toEqual({ ok: false, reason: "calls" });
    expect(decideBudget(state(0, 1_000), LIMITS)).toEqual({ ok: false, reason: "tokens" });
  });

  it("两维同时超时报 calls——个人维度比全站维度更能指导用户", () => {
    expect(decideBudget(state(50, 1_000), LIMITS)).toEqual({ ok: false, reason: "calls" });
  });

  it("0 = 不限制，不是「全拦」", () => {
    expect(decideBudget(state(1e9, 1e12), { callLimit: 0, tokenLimit: 0 })).toEqual({ ok: true });
  });

  it("只关掉一维，另一维照常生效", () => {
    const onlyTokens: BudgetLimits = { callLimit: 0, tokenLimit: 1_000 };
    expect(decideBudget(state(1e6, 999), onlyTokens)).toEqual({ ok: true });
    expect(decideBudget(state(1e6, 1_000), onlyTokens)).toEqual({ ok: false, reason: "tokens" });
  });

  it("limit = 1 时第一次调用（calls = 0）放行，第二次拦——手工验 429 就是用这个值", () => {
    const one: BudgetLimits = { callLimit: 1, tokenLimit: 0 };
    expect(decideBudget(state(0, 0), one)).toEqual({ ok: true });
    expect(decideBudget(state(1, 0), one)).toEqual({ ok: false, reason: "calls" });
  });
});

describe("startOfDay", () => {
  it("UTC 下就是当天 0 点", () => {
    expect(startOfDay(new Date("2026-10-05T13:27:51Z"), 0).toISOString()).toBe(
      "2026-10-05T00:00:00.000Z",
    );
  });

  it("+480（UTC+8）下日界落在前一天的 16:00Z", () => {
    expect(startOfDay(new Date("2026-10-05T13:27:51Z"), 480).toISOString()).toBe(
      "2026-10-04T16:00:00.000Z",
    );
  });

  it("跨日边界按传入的偏移量算，与服务器时区无关", () => {
    // 北京 2026-10-05 23:59:59 → 仍属于 10-05
    expect(startOfDay(new Date("2026-10-05T15:59:59Z"), 480).toISOString()).toBe(
      "2026-10-04T16:00:00.000Z",
    );
    // 北京 2026-10-06 00:00:00 → 跳到 10-06
    expect(startOfDay(new Date("2026-10-05T16:00:00Z"), 480).toISOString()).toBe(
      "2026-10-05T16:00:00.000Z",
    );
  });

  it("负偏移也支持——readInt 的默认 min=0 会把 -300 当非法值静默回退，读 env 时必须传 -720", () => {
    expect(startOfDay(new Date("2026-10-05T02:00:00Z"), -300).toISOString()).toBe(
      "2026-10-04T05:00:00.000Z",
    );
  });

  it("返回的时刻永远不晚于入参——预算是「从今天 0 点起算」，不能把未来的量算进去", () => {
    const cases = [
      ["2026-10-05T00:00:00Z", 0],
      ["2026-10-05T00:00:00Z", 480],
      ["2026-10-05T23:59:59Z", -300],
    ] as const;
    for (const [iso, offset] of cases) {
      const at = new Date(iso);
      expect(startOfDay(at, offset).getTime()).toBeLessThanOrEqual(at.getTime());
    }
  });
});

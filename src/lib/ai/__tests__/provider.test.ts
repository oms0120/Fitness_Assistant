/**
 * `getProvider()` 的**静默降级**分支：`AI_PROVIDER` 指定了某一家，但对应的 key 没配，
 * 于是 `resolveMode()` 返回 "rule" —— 用户以为在用模型，其实一直吃模板。
 *
 * 这里钉的就是「静默」这两个字：降级必须留下一条带 requestId 的 warn，否则事后无从查起。
 *
 * 纯 env，不需要网络也不需要 DB：四条用例全都停在**构造** provider 那一步，一次模型都不会调。
 * （没配 key 的那几条根本走不到 `LlmProvider`；配了 key 那条只 `new LlmProvider(...)`，
 * 它的 sink 是惰性的，同样不碰 DB。）
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { getProvider } from "@/lib/ai/provider";
import { RuleProvider } from "@/lib/ai/ruleProvider";
import { logger } from "@/lib/logger";

const KEYS = ["AI_PROVIDER", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"] as const;

let saved: Record<string, string | undefined> = {};
let warnSpy: MockInstance;

// 每条用例都从「三个变量全都没设」开始，用完原样放回去（同 llm.test.ts）。
beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

describe("getProvider", () => {
  it("指定了 provider 但缺 key → 落到规则库，并记一条带 requestId 的 warn", async () => {
    process.env.AI_PROVIDER = "deepseek";

    expect(getProvider("u1", "trace-degrade")).toBeInstanceOf(RuleProvider);
    expect(warnSpy).toHaveBeenCalledWith(
      { requestId: "trace-degrade", requested: "deepseek" },
      expect.stringContaining("规则库"),
    );
  });

  it("指定的那家缺 key、而另一家的 key 在 → 仍然 warn（不会悄悄换一家）", () => {
    // 想要 claude 却没配 Anthropic 的 key，DeepSeek 的 key 却在。resolveMode 会降级到
    // rule 而不是改用 DeepSeek —— 静默换后端等于账单和输出风格都对不上。
    process.env.AI_PROVIDER = "claude";
    process.env.DEEPSEEK_API_KEY = "sk-x";

    expect(getProvider("u1", "trace-x")).toBeInstanceOf(RuleProvider);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("AI_PROVIDER=rule 不 warn —— 那是主动选的模式，不是降级", () => {
    // 评测和 CI 全靠这一条「不花钱跑一遍」。
    process.env.AI_PROVIDER = "rule";
    process.env.DEEPSEEK_API_KEY = "sk-x";

    expect(getProvider("u1", "trace-rule")).toBeInstanceOf(RuleProvider);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("一个 key 都没配、也没指定 provider → 不 warn", () => {
    // 这是没配 key 的开发机和评测机的常态。这里也打日志的话，真正的降级会被淹掉。
    expect(getProvider("u1", "trace-plain")).toBeInstanceOf(RuleProvider);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("key 齐时不 warn，也不返回规则库", () => {
    process.env.AI_PROVIDER = "deepseek";
    process.env.DEEPSEEK_API_KEY = "sk-x";

    expect(getProvider()).not.toBeInstanceOf(RuleProvider);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

/**
 * `llm.ts` 的两条分派逻辑。纯函数 + env，**不需要任何 mock 基建**。
 *
 * `resolveMode` 决定走不走模型，也就是花不花钱 —— 一个分支写错，在配了 key 的
 * 环境里会静默退化成规则库（用户以为在用模型，其实一直吃的是模板），或者反过来
 * 没 key 却去调 API、每次都以 401 收场。
 *
 * `getBackend` 是**第二份 switch**，把同一个模式映射到具体后端。两份分派各写各的，
 * 改了前者忘了后者就会错配成「模式是 deepseek」但 `getBackend()` 返回 `null` ——
 * 运行时空指针。最后一条用例专门交叉验这件事。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getBackend, resolveMode } from "@/lib/ai/llm";

const KEYS = ["AI_PROVIDER", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"] as const;

let saved: Record<string, string | undefined> = {};

// 每个用例都从「三个变量全都没设」开始，用完原样放回去。
beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("resolveMode", () => {
  it("什么都没配 → rule", () => {
    expect(resolveMode()).toBe("rule");
  });

  it("没指定 AI_PROVIDER 时按已有的 key 自动探测", () => {
    process.env.DEEPSEEK_API_KEY = "sk-x";
    expect(resolveMode()).toBe("deepseek");
  });

  it("只有 Claude 的 key → claude", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(resolveMode()).toBe("claude");
  });

  it("两个 key 都有时优先 DeepSeek", () => {
    process.env.DEEPSEEK_API_KEY = "sk-x";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(resolveMode()).toBe("deepseek");
  });

  it("AI_PROVIDER=rule 时即使配了 key 也走规则库", () => {
    // 这条是评测和 CI 的前提：没有它，「不花钱跑一遍」就只能靠不配 key 来保证。
    process.env.AI_PROVIDER = "rule";
    process.env.DEEPSEEK_API_KEY = "sk-x";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(resolveMode()).toBe("rule");
  });

  it("显式指定且 key 齐 → 用指定的那家", () => {
    process.env.DEEPSEEK_API_KEY = "sk-x";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";

    process.env.AI_PROVIDER = "claude";
    expect(resolveMode()).toBe("claude");
    process.env.AI_PROVIDER = "deepseek";
    expect(resolveMode()).toBe("deepseek");
  });

  it("显式指定但缺 key → 降级回 rule，不是硬报错", () => {
    process.env.AI_PROVIDER = "deepseek";
    expect(resolveMode()).toBe("rule");
  });

  it("指定的那家缺 key 时，不会顺手改用另一家已配好的 key", () => {
    // 想要 claude 但没配 Anthropic 的 key，而 DeepSeek 的 key 在 → 应当降级到
    // rule，而不是悄悄换一家。静默换后端等于账单和输出风格都对不上。
    process.env.AI_PROVIDER = "claude";
    process.env.DEEPSEEK_API_KEY = "sk-x";
    expect(resolveMode()).toBe("rule");
  });

  it("认不出的 AI_PROVIDER 落回自动探测", () => {
    process.env.AI_PROVIDER = "gpt";
    expect(resolveMode()).toBe("rule");

    process.env.DEEPSEEK_API_KEY = "sk-x";
    expect(resolveMode()).toBe("deepseek");
  });

  it("空的 AI_PROVIDER 和没设一样", () => {
    // switch ("") 不匹配任何 case，落到 default。
    process.env.AI_PROVIDER = "";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    expect(resolveMode()).toBe("claude");
  });

  it("空字符串的 key 不算配了 key", () => {
    // Boolean("") 是 false。`.env` 里一行 `DEEPSEEK_API_KEY=` 不该被当成配好了，
    // 否则会走到 deepseek 分支、在 provider 里才抛「未配置 API key」。
    process.env.DEEPSEEK_API_KEY = "";
    expect(resolveMode()).toBe("rule");
  });

  it("只有空白的 key 也不算配了 key", () => {
    // Boolean("   ") 是 true，所以这里必须是 `Boolean(env.X?.trim())`。
    // 不 trim 的话 resolveMode 会报 claude，然后拿这个空白 key 去请求、每次 401 ——
    // 而本该发生的是**静默降级到规则库**，用户至少还能拿到模板结果。
    process.env.ANTHROPIC_API_KEY = "   ";
    process.env.DEEPSEEK_API_KEY = "\t\n";
    expect(resolveMode()).toBe("rule");
  });
});

describe("getBackend", () => {
  it("rule 模式没有后端", async () => {
    process.env.AI_PROVIDER = "rule";
    await expect(getBackend()).resolves.toBeNull();
  });

  it("deepseek 模式返回 DeepSeek 后端", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-x";
    process.env.AI_PROVIDER = "deepseek";
    expect((await getBackend())?.name).toBe("deepseek");
  });

  it("claude 模式返回 Claude 后端", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";
    process.env.AI_PROVIDER = "claude";
    // 后端是动态 import 的，所以这条顺带验了模块路径没写错。
    //
    // 单独放宽到 15s，是这一条唯一需要的特殊待遇：动态 import 拖进来的是
    // @anthropic-ai/sdk（9.1MB），首次 transform 的耗时随机器负载在 9s ~ 73s 之间摆
    // （实测），而 vitest 默认 testTimeout 是 5s —— 同一台机器连跑六次出现过 1 次、
    // 2 次超时，报的都是这里。CI 的 runner 只有 2 核，不单独放宽就是随机红。
    // 不用全局 testTimeout：那会连真正挂死的用例一起掩盖掉。
    expect((await getBackend())?.name).toBe("claude");
  }, 15000);

  it("和 resolveMode 不错配：非 rule 模式一定拿得到后端", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-x";
    process.env.ANTHROPIC_API_KEY = "sk-ant-x";

    for (const provider of ["deepseek", "claude"] as const) {
      process.env.AI_PROVIDER = provider;
      expect(resolveMode()).toBe(provider);
      expect(await getBackend()).not.toBeNull();
    }
  });
});

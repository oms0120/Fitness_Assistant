/**
 * `chatJson()` 的单点埋点：每一条真实模型调用写一行记录。
 *
 * 真起本地假 DeepSeek 服务，走**完整**链路（chatJson → getBackend → deepseekBackend → fetch），
 * 一层都不打桩 —— 要验的正是"这一层真插在调用方和后端之间了，而且没把 onUsage
 * 这条既有契约弄坏"。mock 掉 backend 的话，测的就是我自己写的假后端。
 *
 * 用假服务而不是断言「传了 promptVersion 就会打日志」这种间接证据：后两个用例
 * 是这次改动**最可能弄坏**的东西（包装 onUsage 会把调用方的回调吞掉、会改变异常
 * 边界），只有真跑一遍才知道没坏。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from "vitest";
import { z } from "zod";
import { chatJson, type LlmUsage } from "@/lib/ai/llm";
import { logger } from "@/lib/logger";

const KEYS = [
  "AI_PROVIDER",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_RETRIES",
] as const;

let server: Server;
let baseUrl: string;
let saved: Record<string, string | undefined> = {};
let infoSpy: MockInstance;
let errorSpy: MockInstance;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        model: "deepseek-chat",
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: { prompt_tokens: 812, completion_tokens: 140 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  saved = {};
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.AI_PROVIDER = "deepseek";
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.DEEPSEEK_BASE_URL = baseUrl;
  // 不重试：这段测的是埋点，不是 resilience
  process.env.DEEPSEEK_RETRIES = "0";

  infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
  errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

const opts = {
  system: "只输出 JSON",
  user: "ping",
  schema: z.object({ ok: z.boolean() }),
  promptVersion: "test-v1",
  requestId: "trace-llm-1",
};

describe("chatJson", () => {
  it("成功调用写一行 info，字段就是请求的那几样", async () => {
    await expect(chatJson(opts)).resolves.toEqual({ ok: true });

    // 逐字段写全而不是 objectContaining：多出字段（比如以后有人塞了整条 prompt 进来）
    // 应该让这条红。`provider` 就是 mode —— 各后端把它设成自己的 name。
    expect(infoSpy).toHaveBeenCalledWith(
      {
        provider: "deepseek",
        model: "deepseek-chat",
        promptTokens: 812,
        completionTokens: 140,
        latencyMs: expect.any(Number),
        promptVersion: "test-v1",
        requestId: "trace-llm-1",
      },
      "[llm] 调用完成",
    );
  });

  it("调用方的 onUsage 照样收到用量 —— 包一层不能把它吃掉", async () => {
    const seen: LlmUsage[] = [];
    await chatJson({ ...opts, onUsage: (u) => seen.push(u) });

    expect(seen).toHaveLength(1);
    expect(seen[0].promptTokens).toBe(812);
    expect(seen[0].completionTokens).toBe(140);
  });

  it("调用方的 sink 抛异常时结果照常返回 —— 埋点没动这条既有的容错", async () => {
    await expect(
      chatJson({
        ...opts,
        onUsage: () => {
          throw new Error("记账炸了");
        },
      }),
    ).resolves.toEqual({ ok: true });

    // 后端那道 try/catch 仍然接住了它（契约见 ChatJsonOptions.onUsage）
    expect(errorSpy).toHaveBeenCalled();
  });
});

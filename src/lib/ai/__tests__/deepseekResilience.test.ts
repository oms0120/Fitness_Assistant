/**
 * 真起本地 HTTP 假服务测 DeepSeek 后端的两个侧面，都不用 mock fetch：
 *
 * 1. **封顶而不是挂死**：把 `DEEPSEEK_BASE_URL` 指向不可达 / 不回响应的地址，
 *    请求必须在「超时 × 尝试次数 + 退避」这个上限内失败，并且真的重试过。
 *    这两条是 resilience.ts 里最容易只写在文档里、实际没接上的性质 ——
 *    少了 `AbortSignal.timeout` 会无限挂起，少了 `withRetry` 则一次都不重试，
 *    两者都不会让任何单测变红，只有真打一次网络才看得出来。
 *
 * 2. **用量回调的触发时机**：`onUsage` 必须在响应体解析之后、**任何校验之前**触发。
 *    被 `JSON.parse` / `schema.parse` 拒绝的响应照样计费，晚一步就漏记最贵的那些调用。
 *    这一条也只有真打一次网络才测得到。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { deepseekBackend, deepseekUsageToLlmUsage } from "@/lib/ai/deepseekProvider";
import { claudeUsageToLlmUsage } from "@/lib/ai/claudeProvider";
import { HttpError } from "@/lib/ai/resilience";
import type { LlmUsage } from "@/lib/ai/llm";

const opts = { system: "只输出 JSON", user: "ping", schema: z.object({ ok: z.boolean() }) };
const saved: Record<string, string | undefined> = {};

/** 只接受连接、永不回响应的服务器——用来制造"超时"而不是"连不上"。 */
let server: Server;
let hangingUrl: string;
let hits = 0;

beforeAll(async () => {
  server = createServer(() => {
    hits++;
    // 故意既不回响应也不关连接
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  hangingUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  // abort 掉的是 fetch 那侧，服务端这边的 socket 还挂着，直接 close 会等它们超时
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  for (const key of ["DEEPSEEK_BASE_URL", "DEEPSEEK_TIMEOUT_MS", "DEEPSEEK_RETRIES"]) {
    saved[key] = process.env[key];
  }
  process.env.DEEPSEEK_API_KEY = "test-key";
  // 重试会被 onRetry 打出来，测试输出里不需要
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

describe("DeepSeek 后端的超时与重试", () => {
  it("地址不可达：快速失败而不是耗到超时上限", async () => {
    // 9 是 discard 端口，本机必然 ECONNREFUSED
    process.env.DEEPSEEK_BASE_URL = "http://127.0.0.1:9";
    process.env.DEEPSEEK_TIMEOUT_MS = "2000";
    process.env.DEEPSEEK_RETRIES = "1";

    const t0 = Date.now();
    await expect(deepseekBackend.chatJson(opts)).rejects.toThrow();
    // 走超时的话是 2 × 2000 + 退避 ≈ 4.5 s，连不上则是 0 ms + 退避 ≈ 0.5 s
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it("服务不回响应：在超时上限内失败，并且重试了", async () => {
    hits = 0;
    process.env.DEEPSEEK_BASE_URL = hangingUrl;
    process.env.DEEPSEEK_TIMEOUT_MS = "300";
    process.env.DEEPSEEK_RETRIES = "1";

    const t0 = Date.now();
    await expect(deepseekBackend.chatJson(opts)).rejects.toThrow();
    const elapsed = Date.now() - t0;

    expect(hits).toBe(2); // 首发 + 1 次重试，说明 withRetry 确实接上了
    // 2 × 300 ms 超时 + 一次退避（250–500 ms）
    expect(elapsed).toBeGreaterThanOrEqual(600);
    expect(elapsed).toBeLessThan(2000);
  }, 10_000);

  it("DEEPSEEK_RETRIES=0 时只打一次", async () => {
    hits = 0;
    process.env.DEEPSEEK_BASE_URL = hangingUrl;
    process.env.DEEPSEEK_TIMEOUT_MS = "300";
    process.env.DEEPSEEK_RETRIES = "0";

    await expect(deepseekBackend.chatJson(opts)).rejects.toThrow();
    expect(hits).toBe(1);
  }, 10_000);
});

/** 会正常回响应的服务器；body 由 `payload` 决定，每个用例自己设。 */
describe("DeepSeek 的用量回调", () => {
  let api: Server;
  let apiUrl: string;
  let payload: unknown;

  beforeAll(async () => {
    api = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));
    apiUrl = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    api.closeAllConnections();
    await new Promise<void>((resolve) => api.close(() => resolve()));
  });

  beforeEach(() => {
    process.env.DEEPSEEK_BASE_URL = apiUrl;
    process.env.DEEPSEEK_RETRIES = "0";
    process.env.DEEPSEEK_MODEL = "deepseek-chat";
  });

  const okContent = JSON.stringify({ ok: true });

  it("正常响应：回调拿到真实 token 数与模型名", async () => {
    payload = {
      model: "deepseek-chat",
      choices: [{ message: { content: okContent } }],
      usage: { prompt_tokens: 123, completion_tokens: 45 },
    };
    const seen: LlmUsage[] = [];

    await expect(
      deepseekBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).resolves.toEqual({ ok: true });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      provider: "deepseek",
      model: "deepseek-chat",
      promptTokens: 123,
      completionTokens: 45,
    });
    expect(seen[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("响应里没有 usage 时记 0，模型名回退到配置值", async () => {
    payload = { choices: [{ message: { content: okContent } }] };
    const seen: LlmUsage[] = [];

    await deepseekBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ promptTokens: 0, completionTokens: 0, model: "deepseek-chat" });
  });

  it("响应过不了 schema 时**也要**回调——被拒的响应照样计费", async () => {
    payload = {
      model: "deepseek-chat",
      choices: [{ message: { content: JSON.stringify({ ok: "不是 boolean" }) } }],
      usage: { prompt_tokens: 7, completion_tokens: 8 },
    };
    const seen: LlmUsage[] = [];

    await expect(
      deepseekBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow();

    // 本文件里价值最高的一条：schema.parse 发生在计费之后，回调晚一步就会把
    // 「模型答歪了」的调用全部漏记，而那恰恰是最该被看见的一批。
    expect(seen).toHaveLength(1);
    expect(seen[0].promptTokens).toBe(7);
  });

  it("内容不是合法 JSON 时也要回调", async () => {
    payload = {
      choices: [{ message: { content: "这不是 JSON" } }],
      usage: { prompt_tokens: 3, completion_tokens: 4 },
    };
    const seen: LlmUsage[] = [];

    await expect(
      deepseekBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow();

    expect(seen).toHaveLength(1);
    expect(seen[0].promptTokens).toBe(3);
  });

  it("内容为空时也要回调", async () => {
    payload = { choices: [{ message: {} }], usage: { prompt_tokens: 9, completion_tokens: 0 } };
    const seen: LlmUsage[] = [];

    await expect(
      deepseekBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow();

    expect(seen).toHaveLength(1);
    expect(seen[0].promptTokens).toBe(9);
  });

  it("回调自己抛异常也不影响调用结果——否则一次记账失败会被当成模型失败", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    payload = {
      choices: [{ message: { content: okContent } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };

    await expect(
      deepseekBackend.chatJson({
        ...opts,
        onUsage: () => {
          throw new Error("记账炸了");
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
  });
});

describe("用量字段映射", () => {
  it("DeepSeek（OpenAI 兼容）取 prompt_tokens / completion_tokens", () => {
    expect(deepseekUsageToLlmUsage({ prompt_tokens: 10, completion_tokens: 20 })).toEqual({
      promptTokens: 10,
      completionTokens: 20,
    });
  });

  it("DeepSeek 的 usage 整个缺失时全是 0", () => {
    expect(deepseekUsageToLlmUsage(undefined)).toEqual({ promptTokens: 0, completionTokens: 0 });
  });

  it("Claude 取 input_tokens / output_tokens", () => {
    expect(claudeUsageToLlmUsage({ input_tokens: 100, output_tokens: 30 })).toEqual({
      promptTokens: 100,
      completionTokens: 30,
    });
  });

  it("Claude 的 cache token 折进 promptTokens——缓存也是钱，丢了会低估成本", () => {
    expect(
      claudeUsageToLlmUsage({
        input_tokens: 100,
        output_tokens: 30,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 500,
      }),
    ).toEqual({ promptTokens: 2600, completionTokens: 30 });
  });

  it("Claude 的 cache 字段是 null 时当 0", () => {
    expect(
      claudeUsageToLlmUsage({
        input_tokens: 5,
        output_tokens: 6,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      }),
    ).toEqual({ promptTokens: 5, completionTokens: 6 });
  });
});

/**
 * 非 2xx 的路径。`fetch` 对 4xx/5xx **不抛异常**，所以 provider 里那句
 * `if (!r.ok) throw new HttpError(...)` 是唯一的把关点 —— 少了它，一个 401 的
 * 错误正文会被当成正常响应，继续往下走 JSON.parse + schema.parse。
 *
 * 这里特意**不用** `vi.stubGlobal("fetch")`：桩直接把 `HttpError` 抛出来，恰恰把
 * 要验的那三行转换代码绕过去了，测试会变成自证。真起一个能设状态码的服务器才验得到。
 */
describe("DeepSeek 的 HTTP 错误", () => {
  let errorApi: Server;
  let errorApiUrl: string;
  let status = 200;
  let payload = "";
  let requests = 0;

  beforeAll(async () => {
    errorApi = createServer((_req, res) => {
      requests++;
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(payload);
    });
    await new Promise<void>((resolve) => errorApi.listen(0, "127.0.0.1", resolve));
    errorApiUrl = `http://127.0.0.1:${(errorApi.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    errorApi.closeAllConnections();
    await new Promise<void>((resolve) => errorApi.close(() => resolve()));
  });

  beforeEach(() => {
    status = 200;
    payload = "";
    requests = 0;
    process.env.DEEPSEEK_BASE_URL = errorApiUrl;
  });

  it("401 → 抛 HttpError 且带状态码，一次都不重试", async () => {
    status = 401;
    payload = JSON.stringify({ error: { message: "Invalid API key" } });
    process.env.DEEPSEEK_RETRIES = "3";

    const err = await deepseekBackend.chatJson(opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(401);
    // 参数错了重试多少次还是错，而每次都是真金白银（也是日预算在数的那些次）
    expect(requests).toBe(1);
  });

  it("503 → 重试到耗尽，抛的是最后一个 HttpError", async () => {
    status = 503;
    payload = "{}";
    process.env.DEEPSEEK_RETRIES = "2";

    const err = await deepseekBackend.chatJson(opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(503);
    expect(requests).toBe(3); // 首发 + 2 次重试
  });

  it("错误正文不是 JSON 时也抛得出 HttpError——上游 502 常常回 HTML", async () => {
    // 转换那一步用的是 `r.text()` 而不是 `r.json()`：用 r.json() 的话，一个 HTML
    // 的错误页会在这里再抛一个 SyntaxError，把真正的 502 盖掉。
    status = 502;
    payload = "<html><body>Bad Gateway</body></html>";
    process.env.DEEPSEEK_RETRIES = "0";

    const err = await deepseekBackend.chatJson(opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(502);
    expect((err as Error).message).toContain("Bad Gateway");
  });

  it("非 2xx 不触发 onUsage——被拒的请求不计费", async () => {
    status = 429;
    payload = JSON.stringify({ error: { message: "rate limited" } });
    process.env.DEEPSEEK_RETRIES = "0";
    const seen: LlmUsage[] = [];

    await expect(
      deepseekBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow();

    // 反过来的错误更贵：把 429/500 也记成一次调用，账单会系统性虚高。
    expect(seen).toHaveLength(0);
  });

  it("错误信息里带上游返回的片段，且截断在 200 字符", async () => {
    status = 400;
    payload = JSON.stringify({ error: { message: "x".repeat(500) } });
    process.env.DEEPSEEK_RETRIES = "0";

    const err = (await deepseekBackend.chatJson(opts).catch((e: unknown) => e)) as Error;
    expect(err.message).toContain("DeepSeek API 错误 400");
    // 整段塞进 message 会让日志和错误上报爆掉；前缀约 21 字符 + 200
    expect(err.message.length).toBeLessThan(250);
  });
});

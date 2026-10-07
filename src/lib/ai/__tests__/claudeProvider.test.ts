/**
 * Claude 后端的真实验证：起一个本地假服务器（标准 Messages API 形状），用
 * `ANTHROPIC_BASE_URL` 把 SDK 指过去。
 *
 * **为什么不用 mock。** `messages.parse()` + `zodOutputFormat` 的全部价值就在于
 * **SDK 自己**把响应里第一个 text block 的内容交给 schema 解析出 `parsed_output`
 * （`wrappers/parser.mjs` 的 `parseMessage`）。把 SDK mock 掉，测的就是我自己写的一个
 * 假 parse —— 等于什么都没验。真发一次 HTTP 才验得到 `parsed_output`、`response.model`、
 * `response.usage` 确实来自线上响应。和 `deepseekResilience.test.ts` 是同一套路，
 * 那边用 `DEEPSEEK_BASE_URL`。
 *
 * **一个文件共用一个 client。** `claudeProvider` 里 `client ??=` 是模块级缓存，
 * 构造完就不再读 env 了。所以 `ANTHROPIC_BASE_URL` / `ANTHROPIC_API_KEY` /
 * `ANTHROPIC_MAX_RETRIES` 必须在**第一次调用之前**设好（`beforeAll`），
 * 且全程只能有一个假服务器 —— 要换行为就改它的响应，不能换地址。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { claudeBackend } from "@/lib/ai/claudeProvider";
import { logger } from "@/lib/logger";
import type { LlmUsage } from "@/lib/ai/llm";

const opts = { system: "只输出 JSON", user: "ping", schema: z.object({ ok: z.boolean() }) };

let api: Server;
let requests = 0;
let status = 200;
/** 200 时回这个 message。 */
let message: Record<string, unknown> = {};
/** 非 200 时回这个错误体。 */
let errorBody: Record<string, unknown> = {};

/** 一个"标准"的成功响应，各用例只改自己关心的一两个字段。 */
const okMessage = (content: unknown[]): Record<string, unknown> => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model: "claude-opus-5",
  content,
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5 },
});

beforeAll(async () => {
  api = createServer((_req, res) => {
    requests++;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status === 200 ? message : errorBody));
  });
  await new Promise<void>((resolve) => api.listen(0, "127.0.0.1", resolve));

  // 必须在任何 chatJson 调用之前：client 是模块级缓存，之后不再读 env
  process.env.ANTHROPIC_API_KEY = "sk-ant-test";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
  // 非 2xx 的用例要断言"只打了一次"，所以关掉 SDK 自己的重试
  process.env.ANTHROPIC_MAX_RETRIES = "0";
});

afterAll(async () => {
  api.closeAllConnections();
  await new Promise<void>((resolve) => api.close(() => resolve()));
});

beforeEach(() => {
  requests = 0;
  status = 200;
  message = okMessage([{ type: "text", text: JSON.stringify({ ok: true }) }]);
  errorBody = { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } };
});

describe("Claude 后端的结构化输出", () => {
  it("正常响应：SDK 从第一个 text block 里解出 parsed_output", async () => {
    await expect(claudeBackend.chatJson(opts)).resolves.toEqual({ ok: true });
  });

  it("usage 和 model 来自响应本身，不是配置值", async () => {
    const seen: LlmUsage[] = [];
    await claudeBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      provider: "claude",
      model: "claude-opus-5", // 服务器说了算，不是代码里写死的那个
      promptTokens: 10,
      completionTokens: 5,
    });
    expect(seen[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("cache token 折进 promptTokens——缓存也是钱", async () => {
    message = {
      ...okMessage([{ type: "text", text: JSON.stringify({ ok: true }) }]),
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_input_tokens: 2000,
        cache_read_input_tokens: 500,
      },
    };
    const seen: LlmUsage[] = [];
    await claudeBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) });

    expect(seen[0].promptTokens).toBe(2510);
  });

  it("没有 text block 时 parsed_output 是 null → provider 自己抛错", async () => {
    // 扩展思考的响应里可能只有 thinking block。SDK 的 parse 不报错（parsed_output
    // 就是 null），是 provider 这道检查兜住的。
    message = okMessage([{ type: "thinking", thinking: "嗯……" }]);
    await expect(claudeBackend.chatJson(opts)).rejects.toThrow("Claude 未返回结构化结果");
  });

  it("schema 对不上时抛错，而不是把歪数据当成功返回", async () => {
    message = okMessage([{ type: "text", text: JSON.stringify({ ok: "不是 boolean" }) }]);
    await expect(claudeBackend.chatJson(opts)).rejects.toThrow();
  });

  it("回调自己抛异常也不影响调用结果——一次记账失败不该被当成模型失败", async () => {
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});
    await expect(
      claudeBackend.chatJson({
        ...opts,
        onUsage: () => {
          throw new Error("记账炸了");
        },
      }),
    ).resolves.toEqual({ ok: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * 这里有一条**和 DeepSeek 侧相反**的性质，是本次唯一没有在别处记录过的发现：
 *
 * Claude 的 `parsed_output` 是 SDK 在 `messages.parse()` **内部**算出来的。内容不是
 * 合法 JSON、或者过不了 zod 时，`outputFormat.parse` 在 SDK 里就抛了 —— 于是
 * `await getClient().messages.parse(...)` 这一行直接抛出，**provider 里的 onUsage
 * 根本没机会执行**。
 *
 * 而 DeepSeek 侧是先 `res.json()`、回调、再校验（`deepseekResilience.test.ts` 有
 * 一条专门的用例断言"过不了 schema 也要回调"）。两边语义不一致，且 Claude 这侧
 * 是**漏记**的方向：最该被看见的"模型答歪了"的调用一条都记不上。
 * 要修得改成 `messages.create()` 自己 parse，是另一件事，本次只把现状钉住。
 */
describe("Claude 的 onUsage 触发时机（与 DeepSeek 不一致）", () => {
  it("parsed_output 为 null 时仍然回调——错在 provider，晚于回调", async () => {
    message = okMessage([]);
    const seen: LlmUsage[] = [];

    await expect(
      claudeBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow("Claude 未返回结构化结果");

    expect(seen).toHaveLength(1);
    expect(seen[0].promptTokens).toBe(10);
  });

  it("内容不是合法 JSON 时**不回**调——SDK 在 .parse() 里就抛了", async () => {
    message = okMessage([{ type: "text", text: "这不是 JSON" }]);
    const seen: LlmUsage[] = [];

    await expect(
      claudeBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow();

    // requests === 1 是关键：服务器确实被打到了、也确实回了 200，
    // 所以 seen 为空只能是"回调没被执行"，不可能是"根本没拿到响应"。
    expect(requests).toBe(1);
    // 与上一个用例对照着看：同样是"校验失败"，这里却漏记了。
    expect(seen).toHaveLength(0);
  });

  it("schema 过不了时也**不回**调——同样是 SDK 内部抛的", async () => {
    message = okMessage([{ type: "text", text: JSON.stringify({ ok: 1 }) }]);
    const seen: LlmUsage[] = [];

    await expect(
      claudeBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow();

    expect(requests).toBe(1);
    expect(seen).toHaveLength(0);
  });
});

describe("Claude 的 HTTP 错误", () => {
  it("401 抛 SDK 的错误并带状态码，且不重试（maxRetries=0）", async () => {
    status = 401;
    const err = await claudeBackend.chatJson(opts).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as { status?: number }).status).toBe(401);
    expect(requests).toBe(1);
  });

  it("非 2xx 不回调用量——被拒的请求不计费", async () => {
    status = 500;
    errorBody = { type: "error", error: { type: "api_error", message: "boom" } };
    const seen: LlmUsage[] = [];

    await expect(
      claudeBackend.chatJson({ ...opts, onUsage: (u) => seen.push(u) }),
    ).rejects.toThrow();

    expect(seen).toHaveLength(0);
  });
});

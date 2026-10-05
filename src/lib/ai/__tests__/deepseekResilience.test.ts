/**
 * 真起本地 HTTP 假服务测 DeepSeek 后端，不用 mock fetch。
 *
 * **封顶而不是挂死**：把 `DEEPSEEK_BASE_URL` 指向不可达 / 不回响应的地址，
 * 请求必须在「超时 × 尝试次数 + 退避」这个上限内失败，并且真的重试过。
 * 这两条是 resilience.ts 里最容易只写在文档里、实际没接上的性质 ——
 * 少了 `AbortSignal.timeout` 会无限挂起，少了 `withRetry` 则一次都不重试，
 * 两者都不会让任何单测变红，只有真打一次网络才看得出来。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { deepseekBackend } from "@/lib/ai/deepseekProvider";

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

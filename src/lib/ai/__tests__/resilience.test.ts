import { describe, expect, it, vi } from "vitest";
import {
  HttpError,
  backoffDelay,
  isRetryableError,
  readInt,
  withRetry,
  type WithRetryOptions,
} from "@/lib/ai/resilience";

/** 装好 status 的 HttpError，模拟"服务器明确返回了某个状态码"。 */
const httpError = (status: number) => new HttpError(`HTTP ${status}`, status);

/** undici 的网络层失败长这样：TypeError + cause 上挂着 errno。 */
function fetchFailed(code = "ECONNREFUSED"): TypeError {
  return new TypeError("fetch failed", {
    cause: Object.assign(new Error("connect failed"), { code }),
  });
}

/** 把超时压到 1 ms，让重试的等待不拖慢测试。 */
const FAST: WithRetryOptions = { baseDelayMs: 1, maxDelayMs: 2 };

describe("isRetryableError", () => {
  it("429 和 5xx 可重试", () => {
    expect(isRetryableError(httpError(429))).toBe(true);
    for (const s of [500, 502, 503, 504]) expect(isRetryableError(httpError(s))).toBe(true);
  });

  it("4xx（429 除外）不重试——重试不会让参数错误变对", () => {
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryableError(httpError(s))).toBe(false);
  });

  it("也认 statusCode，不只看 status", () => {
    expect(isRetryableError({ statusCode: 503 })).toBe(true);
    expect(isRetryableError({ statusCode: 400 })).toBe(false);
  });

  it("网络错误和超时可重试", () => {
    expect(isRetryableError(fetchFailed())).toBe(true);
    expect(isRetryableError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    expect(isRetryableError(timeout)).toBe(true);
  });

  it("主动 abort 不重试——TimeoutError 才是超时，AbortError 是用户不想等了", () => {
    expect(isRetryableError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(
      false,
    );
  });

  it("SDK 的连接层错误没有 status，靠名字认出来", () => {
    const err = Object.assign(new Error("Connection error."), { name: "APIConnectionError" });
    expect(isRetryableError(err)).toBe(true);
  });

  it("分类不出来的一律不重试", () => {
    expect(isRetryableError(new Error("DeepSeek 返回的 JSON 解析失败"))).toBe(false);
    expect(isRetryableError(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isRetryableError(new Error("未配置 DEEPSEEK_API_KEY"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("首次成功就不重试", async () => {
    const fn = vi.fn(async () => "ok");
    await expect(withRetry(fn, { retries: 3, ...FAST })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("5xx 之后成功：返回结果，并按 1、2… 报重试次数", async () => {
    const attempts: number[] = [];
    let n = 0;
    const fn = vi.fn(async () => {
      if (++n < 3) throw httpError(503);
      return "ok";
    });

    await expect(
      withRetry(fn, { retries: 3, onRetry: (info) => attempts.push(info.attempt), ...FAST }),
    ).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(attempts).toEqual([1, 2]);
  });

  it("429 会重试", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ === 0) throw httpError(429);
      return "ok";
    });
    await expect(withRetry(fn, { retries: 2, ...FAST })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("4xx 直接抛，一次都不多试", async () => {
    const fn = vi.fn(async () => {
      throw httpError(400);
    });
    await expect(withRetry(fn, { retries: 3, ...FAST })).rejects.toThrow("HTTP 400");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("重试耗尽后抛的是最后一个错误本身，不是包装过的", async () => {
    const last = httpError(500);
    let n = 0;
    const fn = vi.fn(async () => {
      throw n++ === 0 ? httpError(503) : last;
    });
    await expect(withRetry(fn, { retries: 1, ...FAST })).rejects.toBe(last);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries: 0 就只试一次", async () => {
    const fn = vi.fn(async () => {
      throw httpError(500);
    });
    await expect(withRetry(fn, { retries: 0, ...FAST })).rejects.toThrow("HTTP 500");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("判据可以换掉", async () => {
    const fn = vi.fn(async () => {
      throw new Error("业务错误");
    });
    await expect(withRetry(fn, { retries: 2, isRetryable: () => true, ...FAST })).rejects.toThrow(
      "业务错误",
    );
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("backoffDelay", () => {
  it("按 2^n 增长，且永远封顶在 maxDelayMs", () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const ceiling = Math.min(8_000, 500 * 2 ** attempt);
      const delay = backoffDelay(attempt, 500, 8_000);
      expect(delay).toBeGreaterThanOrEqual(ceiling / 2);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
  });

  it("有抖动：同样的入参不会总是同一个值", () => {
    const seen = new Set(Array.from({ length: 50 }, () => backoffDelay(3, 500, 8_000)));
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("readInt", () => {
  it("读得到就用，读不到就回退", () => {
    expect(readInt("1500", 60_000, 1)).toBe(1500);
    expect(readInt(undefined, 60_000, 1)).toBe(60_000);
    expect(readInt("abc", 60_000, 1)).toBe(60_000);
    expect(readInt("1.5", 60_000, 1)).toBe(60_000);
  });

  it("下界可配：超时不能用 0，重试次数可以", () => {
    expect(readInt("0", 60_000, 1)).toBe(60_000);
    expect(readInt("0", 2)).toBe(0);
    expect(readInt("-1", 2)).toBe(2);
  });
});

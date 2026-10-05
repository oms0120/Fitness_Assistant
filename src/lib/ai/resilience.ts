/**
 * 网络调用的重试与超时。**只对可能自愈的失败重试**。
 *
 * `isRetryableError` 的判据：
 *   - HTTP 429 / 5xx            → 重试（限流、网关抖动、上游临时故障）
 *   - HTTP 4xx（429 除外）      → **不重试**。参数错、key 错、schema 不匹配，
 *                                 重试只是把同一个错误再犯两遍，还多付两次钱。
 *   - 超时 / 连接失败 / DNS     → 重试
 *   - 调用方主动 abort          → **不重试**。`AbortSignal.timeout()` 抛的是
 *                                 `TimeoutError`，手动 `controller.abort()` 抛的是
 *                                 `AbortError` —— 名字只差一个词，含义相反，必须分开判。
 *   - 其它（JSON 解析失败、zod 校验失败、我们自己抛的业务错误）
 *                               → 不重试。分类不出来时就当不可重试，宁可少试不要乱试。
 *
 * 退避用 **equal jitter**：`delay = ceiling/2 + random()*ceiling/2`，
 * `ceiling = min(maxDelayMs, baseDelayMs * 2^n)`。不用 full jitter（`0 ~ ceiling`）
 * 是因为那会退化成"立刻重试"，对超时类故障等于没等；留一半确定性保证每次重试真的等了，
 * 随机的一半用来打散同时失败的客户端。
 *
 * 注意：**超时不在这里做**，由调用方在 fetch 上挂 `AbortSignal.timeout(ms)`。
 * 见各 provider 里的注释：signal 必须在每次尝试内部新建。
 */

/** 带 HTTP 状态码的错误。`fetch` 对非 2xx 不抛异常，得由调用方转成它才能被分类。 */
export class HttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export const DEFAULT_RETRIES = 2;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 8_000;

/** undici / Node 的网络层 errno。命中即"连不上"，不是"请求被拒"。 */
const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/**
 * 按名字认的临时故障。`APIConnectionError` / `APIConnectionTimeoutError` 是
 * Anthropic SDK 的连接层错误 —— 它们继承自 `APIError` 但 `status` 是 undefined，
 * 所以会掉到"没有状态码"那一支，靠名字兜住。用字符串而不是 import SDK 的类型，
 * 是为了让这个模块不依赖任何 SDK。
 */
const TRANSIENT_NAMES = new Set(["TimeoutError", "APIConnectionError", "APIConnectionTimeoutError"]);

/** env 里的整数，非法就回退。注意 `min` 默认 0：重试次数 0 是合法值（关掉重试）。 */
export function readInt(value: string | undefined, fallback: number, min = 0): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : fallback;
}

function nameOf(err: unknown): string {
  return typeof err === "object" && err !== null && "name" in err ? String(err.name) : "";
}

function statusOf(err: unknown): number | undefined {
  if (typeof err !== "object" || err === null) return undefined;
  const e = err as Record<string, unknown>;
  // 同时认 status 和 statusCode：Anthropic SDK 用前者，不少 HTTP 库用后者。
  for (const key of ["status", "statusCode"]) {
    if (Number.isInteger(e[key])) return e[key] as number;
  }
  return undefined;
}

function codeOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  const code = (err as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function causeOf(err: unknown): unknown {
  return typeof err === "object" && err !== null && "cause" in err
    ? (err as { cause: unknown }).cause
    : undefined;
}

/** 5xx / 429 / 网络错误 / 超时 → true；4xx（除 429）和其它一切 → false。 */
export function isRetryableError(err: unknown): boolean {
  // 用户不想等了，重试只会把请求拖着不放。
  if (nameOf(err) === "AbortError") return false;

  const status = statusOf(err);
  if (status !== undefined) return status === 429 || status >= 500;

  if (TRANSIENT_NAMES.has(nameOf(err))) return true;

  const code = codeOf(err);
  if (code && NETWORK_CODES.has(code)) return true;

  // fetch 的网络层失败统一是 `TypeError: fetch failed`，真正的 errno 挂在 cause 上。
  // 要求带上 cause 或 message 里有 fetch，免得把真正的 TypeError（代码 bug）也重试三遍。
  if (err instanceof TypeError && (causeOf(err) !== undefined || /fetch/i.test(err.message))) {
    return true;
  }

  return false;
}

/** 第 `attempt` 次失败后（attempt 从 0 起）该等多久。导出是为了能单测边界。 */
export function backoffDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  return Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
}

export interface RetryInfo {
  /** 第几次重试，从 1 起。 */
  attempt: number;
  /** 总尝试次数上限（含首次），即 `retries + 1`。 */
  attempts: number;
  delayMs: number;
  error: unknown;
}

export interface WithRetryOptions {
  /** 重试次数，不含首次。默认 2 → 最多 3 次尝试。 */
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** 覆盖默认判据。默认 `isRetryableError`。 */
  isRetryable?: (err: unknown) => boolean;
  /** 每次决定重试前调一次，用来打日志。不要在里面抛异常。 */
  onRetry?: (info: RetryInfo) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 跑 `fn`，失败且**判定为可重试**时按指数退避重试。重试耗尽后抛最后一个错误本身
 * （不是包装过的），这样调用方看到的还是原始 status/message。
 *
 * 最坏耗时 = `(retries + 1) * 单次超时 + Σ 退避`。默认值下（2 次重试、退避 ≤1.5 s）
 * 就是 `3 × 超时 + 1.5 s` —— 有限，不会挂死。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const isRetryable = options.isRetryable ?? isRetryableError;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const delayMs = backoffDelay(attempt, baseDelayMs, maxDelayMs);
      options.onRetry?.({ attempt: attempt + 1, attempts: retries + 1, delayMs, error: err });
      await sleep(delayMs);
    }
  }
}

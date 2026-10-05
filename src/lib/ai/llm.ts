import { z } from "zod";

/**
 * 一次大模型调用的用量，由各 provider 从 API 响应里解析出来后回调出去。
 *
 * 不带「是否被预算拦下」这个字段：provider 报的永远是**真实发生过**的调用，
 * 被预算拦下的占位行由 `usage.ts` 自己写。
 */
export interface LlmUsage {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

/** LLM 后端：把 system + user 变成一个符合 schema 的 JSON 对象。 */
export interface ChatJsonOptions<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** prompts.ts 的版本常量。出错时带进错误信息，便于定位是哪版 prompt 的回归。 */
  promptVersion?: string;
  /**
   * 拿到响应后回调用量。**必须在响应体解析之后、任何校验之前触发** ——
   * 被 `JSON.parse` 或 `schema.parse` 拒绝的响应照样计费，晚一步就会漏记
   * 最贵的那些调用（`scripts/eval-answer.ts` 甚至会在校验失败时重试两次）。
   *
   * 实现方**必须自己吞掉异常**：这个回调跑在后端内部，抛出去会被 `chatJson`
   * 的 catch 包装成 `[prompt ...]` 错误，让一次 DB 写入失败看起来像 prompt 回归，
   * 而且是在一次已经成功、已经计费的调用之后。
   */
  onUsage?: (u: LlmUsage) => void;
}

export interface LlmBackend {
  readonly name: string;
  chatJson<T>(opts: ChatJsonOptions<T>): Promise<T>;
}

export type LlmMode = "rule" | "deepseek" | "claude";

const hasDeepSeek = () => Boolean(process.env.DEEPSEEK_API_KEY);
const hasClaude = () => Boolean(process.env.ANTHROPIC_API_KEY);

/**
 * 解析当前生效的模式。
 *
 * `AI_PROVIDER` 显式指定时按它走，但缺对应 key 会降级回 rule；
 * 未指定时按已配置的 key 自动探测，省得为了用上 key 还要多配一个变量。
 */
export function resolveMode(): LlmMode {
  switch (process.env.AI_PROVIDER) {
    case "rule":
      return "rule";
    case "deepseek":
      return hasDeepSeek() ? "deepseek" : "rule";
    case "claude":
      return hasClaude() ? "claude" : "rule";
    default:
      if (hasDeepSeek()) return "deepseek";
      if (hasClaude()) return "claude";
      return "rule";
  }
}

/** 取当前后端；rule 模式下没有后端可用。 */
export async function getBackend(): Promise<LlmBackend | null> {
  switch (resolveMode()) {
    case "deepseek": {
      const { deepseekBackend } = await import("./deepseekProvider");
      return deepseekBackend;
    }
    case "claude": {
      const { claudeBackend } = await import("./claudeProvider");
      return claudeBackend;
    }
    default:
      return null;
  }
}

/**
 * 统一的结构化生成入口。rule 模式（未配任何 key）下抛错，
 * 由调用方决定是降级到规则库还是把错误抛给用户。
 *
 * 后端抛出的错误统一补上 prompt 版本，调用方拿到「结构不合法」时
 * 能一眼看出是哪版 prompt 的产出。
 */
export async function chatJson<T>({ promptVersion, ...opts }: ChatJsonOptions<T>): Promise<T> {
  const backend = await getBackend();
  if (!backend) {
    throw new Error(
      "未配置任何大模型 key（DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY），无法调用 AI",
    );
  }
  try {
    return await backend.chatJson(opts);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(promptVersion ? `[prompt ${promptVersion}] ${message}` : message, {
      cause: err,
    });
  }
}

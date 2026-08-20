import { z } from "zod";

/** LLM 后端：把 system + user 变成一个符合 schema 的 JSON 对象。 */
export interface ChatJsonOptions<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
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
 */
export async function chatJson<T>(opts: ChatJsonOptions<T>): Promise<T> {
  const backend = await getBackend();
  if (!backend) {
    throw new Error(
      "未配置任何大模型 key（DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY），无法调用 AI",
    );
  }
  return backend.chatJson(opts);
}

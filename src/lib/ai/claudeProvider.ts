import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { logger } from "@/lib/logger";
import { readInt } from "./resilience";
import type { ChatJsonOptions, LlmBackend } from "./llm";

let client: Anthropic | null = null;

/**
 * 延迟构造：无 ANTHROPIC_API_KEY 时 new Anthropic() 会抛，不能在模块加载期执行。
 *
 * `maxRetries` / `timeout` 显式给：SDK 默认 timeout 是 **10 分钟**，对一次对话请求
 * 等于没有上限；maxRetries 默认虽然是 2，但不写进代码就会被 SDK 升级静默改掉。
 *
 * 这里**不**套 withRetry：SDK 自己就带指数退避 + jitter 的重试，外面再包一层会让
 * 尝试次数相乘（3 × 3 = 9 次），而且内层已经处理过的失败会被重复计费。
 */
function getClient(): Anthropic {
  client ??= new Anthropic({
    // 从 ANTHROPIC_API_KEY 环境变量读
    maxRetries: readInt(process.env.ANTHROPIC_MAX_RETRIES, 2),
    // 16k max_tokens + adaptive thinking 的长响应可能跑到几分钟，留足余量但要封顶
    timeout: readInt(process.env.ANTHROPIC_TIMEOUT_MS, 300_000, 1),
  });
  return client;
}

/**
 * Claude 的 usage → token 数。
 *
 * **cache token 也是钱**：`cache_creation_input_tokens`（写缓存）和
 * `cache_read_input_tokens`（读缓存）都是计费输入，静默丢掉会系统性低估
 * Claude 调用的成本。两者都折进 `promptTokens`。
 */
export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/** 导出是为了能脱离网络单测字段映射。 */
export function claudeUsageToLlmUsage(usage: ClaudeUsage | undefined): {
  promptTokens: number;
  completionTokens: number;
} {
  return {
    promptTokens:
      (usage?.input_tokens ?? 0) +
      (usage?.cache_creation_input_tokens ?? 0) +
      (usage?.cache_read_input_tokens ?? 0),
    completionTokens: usage?.output_tokens ?? 0,
  };
}

/**
 * Claude（官方 SDK）。用 messages.parse + output_config 做结构化输出，
 * 由 API 侧保证结构，不需要像 DeepSeek 那样把 schema 塞进 prompt。
 */
export const claudeBackend: LlmBackend = {
  name: "claude",

  async chatJson<T>({
    system,
    user,
    schema,
    maxTokens,
    onUsage,
    requestId,
  }: ChatJsonOptions<T>): Promise<T> {
    // 这里不套 withRetry，所以这个墙钟就是这一次 SDK 调用的真实耗时。
    const startedAt = Date.now();
    const response = await getClient().messages.parse({
      model: "claude-opus-5",
      max_tokens: maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema) },
    });

    // 必须在 parsed_output 校验之前回调 —— 下面两道校验抛出去的响应照样计费。
    // 详见 deepseekProvider 同名位置的长注释（含外面那层 try 的理由）。
    try {
      onUsage?.({
        provider: "claude",
        model: response.model,
        ...claudeUsageToLlmUsage(response.usage),
        latencyMs: Date.now() - startedAt,
      });
    } catch (err) {
      logger.error({ err, requestId }, "[claude] onUsage 回调失败");
    }

    if (!response.parsed_output) {
      throw new Error("Claude 未返回结构化结果");
    }
    return schema.parse(response.parsed_output);
  },
};

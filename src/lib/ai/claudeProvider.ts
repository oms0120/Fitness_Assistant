import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ChatJsonOptions, LlmBackend } from "./llm";

let client: Anthropic | null = null;

/** 延迟构造：无 ANTHROPIC_API_KEY 时 new Anthropic() 会抛，不能在模块加载期执行。 */
function getClient(): Anthropic {
  client ??= new Anthropic(); // 从 ANTHROPIC_API_KEY 环境变量读
  return client;
}

/**
 * Claude（官方 SDK）。用 messages.parse + output_config 做结构化输出，
 * 由 API 侧保证结构，不需要像 DeepSeek 那样把 schema 塞进 prompt。
 */
export const claudeBackend: LlmBackend = {
  name: "claude",

  async chatJson<T>({ system, user, schema, maxTokens }: ChatJsonOptions<T>): Promise<T> {
    const response = await getClient().messages.parse({
      model: "claude-opus-5",
      max_tokens: maxTokens ?? 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (!response.parsed_output) {
      throw new Error("Claude 未返回结构化结果");
    }
    return schema.parse(response.parsed_output);
  },
};

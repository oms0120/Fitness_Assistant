import { z } from "zod";
import type { ChatJsonOptions, LlmBackend } from "./llm";

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
const MODEL = process.env.DEEPSEEK_MODEL ?? "deepseek-chat";

/**
 * DeepSeek（OpenAI 兼容 /chat/completions）。
 *
 * json_object 模式只保证返回合法 JSON，不保证结构，所以把 schema 注入 system
 * 再用 zod 校验一遍。schema 由 zod 生成而非手写，避免和类型定义漂移。
 */
export const deepseekBackend: LlmBackend = {
  name: "deepseek",

  async chatJson<T>({ system, user, schema, maxTokens }: ChatJsonOptions<T>): Promise<T> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("未配置 DEEPSEEK_API_KEY");
    }

    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: `${system}\n\n只输出 JSON，且严格符合以下 JSON Schema：\n${jsonSchema}` },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens ?? 4096,
        response_format: { type: "json_object" },
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`DeepSeek API 错误 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const content = (await res.json()).choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("DeepSeek 返回为空");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("DeepSeek 返回的 JSON 解析失败");
    }
    return schema.parse(parsed);
  },
};

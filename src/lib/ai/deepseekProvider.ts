import { z } from "zod";
import { HttpError, readInt, withRetry } from "./resilience";
import type { ChatJsonOptions, LlmBackend } from "./llm";

/**
 * env 用函数读而不是模块级常量：脚本（`scripts/eval-answer.ts`）是先 import
 * 再 `process.loadEnvFile()`，模块级常量会在 .env 加载之前就把值读掉。
 * 同 `src/lib/rag/ragClient.ts:13` 的 `ragUrl()`。
 */
function baseUrl(): string {
  return process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
}

function model(): string {
  return process.env.DEEPSEEK_MODEL ?? "deepseek-chat";
}

/** 单次请求的超时上限。非流式、max_tokens 4096，正常在 10–30 s 内返回。 */
function timeoutMs(): number {
  return readInt(process.env.DEEPSEEK_TIMEOUT_MS, 60_000, 1);
}

/**
 * DeepSeek（OpenAI 兼容 /chat/completions）。
 *
 * json_object 模式只保证返回合法 JSON，不保证结构，所以把 schema 注入 system
 * 再用 zod 校验一遍。schema 由 zod 生成而非手写，避免和类型定义漂移。
 *
 * 重试包在 fetch 外面（见 resilience.ts）：`fetch` 对 4xx/5xx 不抛异常，
 * 所以先把非 2xx 转成 `HttpError` 再让它判 —— 4xx 会直接抛出去不重试。
 */
export const deepseekBackend: LlmBackend = {
  name: "deepseek",

  async chatJson<T>({ system, user, schema, maxTokens }: ChatJsonOptions<T>): Promise<T> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error("未配置 DEEPSEEK_API_KEY");
    }

    const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
    const res = await withRetry(
      () =>
        fetch(`${baseUrl()}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model(),
            messages: [
              { role: "system", content: `${system}\n\n只输出 JSON，且严格符合以下 JSON Schema：\n${jsonSchema}` },
              { role: "user", content: user },
            ],
            max_tokens: maxTokens ?? 4096,
            response_format: { type: "json_object" },
            stream: false,
          }),
          // signal 必须在**每次尝试内部**新建：AbortSignal.timeout 从创建那一刻开始计时，
          // 提到 withRetry 外面的话第二次尝试一开始就已经超时了。
          signal: AbortSignal.timeout(timeoutMs()),
        }).then(async (r) => {
          if (!r.ok) {
            throw new HttpError(
              `DeepSeek API 错误 ${r.status}: ${(await r.text()).slice(0, 200)}`,
              r.status,
            );
          }
          return r;
        }),
      {
        retries: readInt(process.env.DEEPSEEK_RETRIES, 2),
        onRetry: ({ attempt, attempts, delayMs, error }) =>
          console.warn(
            `[deepseek] 第 ${attempt}/${attempts} 次尝试失败，${delayMs}ms 后重试：` +
              `${error instanceof Error ? error.message : String(error)}`,
          ),
      },
    );

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

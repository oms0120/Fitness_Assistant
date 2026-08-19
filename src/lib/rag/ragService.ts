import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { searchChunks } from "./ragClient";

const client = new Anthropic();

const ragAnswerSchema = z.object({
  answer: z.string(),
});

export interface RagAnswer {
  answer: string;
  sources: string[];
}

/** 检索文档片段 → 注入 Claude prompt → 生成带出处的回答。 */
export async function askWithRag(question: string): Promise<RagAnswer> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("未配置 ANTHROPIC_API_KEY，无法使用 AI 问答");
  }

  const chunks = await searchChunks(question, 5);
  const context =
    chunks.length > 0
      ? chunks.map((c) => `【${c.source}】${c.text}`).join("\n\n")
      : "（未检索到相关文档片段）";

  const system = `你是健身营养助手。请只根据下面提供的文档片段回答用户问题，不要编造文档外的内容；若片段不足以回答，请如实说明。

文档片段：
${context}`;

  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: question }],
    output_config: { format: zodOutputFormat(ragAnswerSchema) },
  });

  if (!response.parsed_output) {
    throw new Error("RAG 回答生成失败");
  }

  return {
    answer: response.parsed_output.answer,
    sources: chunks.map((c) => c.source),
  };
}

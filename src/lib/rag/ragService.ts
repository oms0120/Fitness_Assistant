import { z } from "zod";
import { searchChunks } from "./ragClient";
import { chatJson, resolveMode } from "@/lib/ai/llm";

const ragAnswerSchema = z.object({
  answer: z.string(),
});

export interface RagAnswer {
  answer: string;
  sources: string[];
}

/** 检索文档片段 → 注入 prompt → 生成带出处的回答。走 llm.ts 选定的后端。 */
export async function askWithRag(question: string): Promise<RagAnswer> {
  // 问答没有规则库可降级，未配 key 时直接告诉用户
  if (resolveMode() === "rule") {
    throw new Error("未配置大模型 key（DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY），无法使用 AI 问答");
  }

  const chunks = await searchChunks(question, 5);
  const context =
    chunks.length > 0
      ? chunks.map((c) => `【${c.source}】${c.text}`).join("\n\n")
      : "（未检索到相关文档片段）";

  const answer = await chatJson({
    system: `你是健身营养助手。请只根据下面提供的文档片段回答用户问题，不要编造文档外的内容；若片段不足以回答，请如实说明。

文档片段：
${context}`,
    user: question,
    schema: ragAnswerSchema,
  });

  return { answer: answer.answer, sources: chunks.map((c) => c.source) };
}

import { searchChunks } from "./ragClient";
import { chatJson, resolveMode } from "@/lib/ai/llm";
import { ragAnswerSchema } from "@/lib/ai/types";
import { RAG_EMPTY_CONTEXT, RAG_PROMPT_VERSION, ragSystemPrompt } from "@/lib/ai/prompts";

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
      : RAG_EMPTY_CONTEXT;

  const answer = await chatJson({
    system: ragSystemPrompt(context),
    user: question,
    schema: ragAnswerSchema,
    promptVersion: RAG_PROMPT_VERSION,
  });

  return { answer: answer.answer, sources: chunks.map((c) => c.source) };
}

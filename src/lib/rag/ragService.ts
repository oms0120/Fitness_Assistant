import { searchChunks, type RagChunk } from "./ragClient";
import { chatJson, resolveMode } from "@/lib/ai/llm";
import { enforceBudget, usageSink } from "@/lib/ai/usage";
import { ragAnswerSchema } from "@/lib/ai/types";
import { RAG_EMPTY_CONTEXT, RAG_PROMPT_VERSION, ragSystemPrompt } from "@/lib/ai/prompts";

export interface RagAnswer {
  answer: string;
  sources: string[];
  /**
   * 实际喂给模型的召回片段。
   *
   * 评测（`scripts/eval-answer.ts`）判 faithfulness 需要看到生成时的**同一份**上下文，
   * 所以在这里一并返回，而不是让调用方自己再检索一次 —— 那样评审看到的不一定是
   * 模型看到的。API 路由只对外暴露 answer/sources，别把整个对象丢出去。
   */
  chunks: RagChunk[];
}

/**
 * 把召回片段渲染成注入 prompt 的上下文。生成与评测共用同一份渲染，
 * 保证评审看到的上下文与模型看到的逐字一致。
 */
export function formatChunks(chunks: RagChunk[]): string {
  return chunks.length > 0
    ? chunks.map((c) => `【${c.source}】${c.text}`).join("\n\n")
    : RAG_EMPTY_CONTEXT;
}

/**
 * 检索文档片段 → 注入 prompt → 生成带出处的回答。走 llm.ts 选定的后端。
 *
 * `userId` 传了才查预算、才记账。**评测脚本没有用户**（`scripts/eval-answer.ts`
 * 与 `smoke.e2e.test.ts`），不传时行为与改造前完全一致。
 */
export async function askWithRag(question: string, userId?: string): Promise<RagAnswer> {
  // 问答没有规则库可降级，未配 key 时直接告诉用户
  if (resolveMode() === "rule") {
    throw new Error("未配置大模型 key（DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY），无法使用 AI 问答");
  }

  // 预算检查放在检索**之前**：被拦下的请求不该先付一次 embedding + 检索的钱。
  // 超限时这里抛 BudgetExceededError，由路由转成 429。
  if (userId) await enforceBudget(userId);

  const chunks = await searchChunks(question, 5);

  const answer = await chatJson({
    system: ragSystemPrompt(formatChunks(chunks)),
    user: question,
    schema: ragAnswerSchema,
    promptVersion: RAG_PROMPT_VERSION,
    onUsage: userId ? usageSink(userId) : undefined,
  });

  return { answer: answer.answer, sources: chunks.map((c) => c.source), chunks };
}

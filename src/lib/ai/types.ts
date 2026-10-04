import { z } from "zod";

export interface RecipeRequest {
  targetCalories: number;
  proteinRatio: number;
  carbRatio: number;
  fatRatio: number;
  goal: "cut" | "bulk" | "maintain";
}

export interface PlanRequest {
  muscleGroup: string;
  level: "beginner" | "intermediate" | "advanced";
  equipment: string;
}

export const recipeSuggestionSchema = z.object({
  name: z.string(),
  calories: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
  ingredients: z.array(z.string()),
  steps: z.array(z.string()),
  reason: z.string(),
});
export type RecipeSuggestion = z.infer<typeof recipeSuggestionSchema>;

export const recipeSuggestionsSchema = z.object({
  suggestions: z.array(recipeSuggestionSchema),
});

export const planExerciseSchema = z.object({
  name: z.string(),
  sets: z.number(),
  reps: z.number(),
});
export const planSuggestionSchema = z.object({
  name: z.string(),
  goal: z.string(),
  exercises: z.array(planExerciseSchema),
});
export type PlanSuggestion = z.infer<typeof planSuggestionSchema>;

/** RAG 问答的模型侧返回体。含 sources 的对完整体见 `lib/rag/ragService` 的 RagAnswer。 */
export const ragAnswerSchema = z.object({
  answer: z.string(),
});
export type RagAnswerPayload = z.infer<typeof ragAnswerSchema>;

/**
 * 答案侧评测的评审返回体（LLM-as-judge）。**仅 `scripts/eval-answer.ts` 使用，不参与线上请求。**
 *
 * 三个轴各管一件事，判据见 prompts.ts 的 judgeSystemPrompt()：
 *   faithfulness 有没有编 / relevance 有没有跑题 / sufficiency 有没有真的回答。
 * 注意：这里**没有**「与参考答案是否一致」这一项 —— 本 schema 测的是有没有编、
 * 有没有跑题、有没有回答，不等于正确率。正确性由检索召回指标 + 人工复核覆盖。
 *
 * sufficiency 是 v2 加的。加之前只有前两项，而「片段不足 → 如实说无法回答」
 * 在前两项上都是满分，导致检索失败（弃答）在答案侧指标里完全不可见。
 */
export const answerJudgementSchema = z.object({
  faithfulness: z.number().int().min(1).max(5),
  relevance: z.number().int().min(1).max(5),
  sufficiency: z.number().int().min(1).max(5),
  reasoning: z.string(),
});
export type AnswerJudgement = z.infer<typeof answerJudgementSchema>;

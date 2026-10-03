/**
 * 三处 LLM prompt 的集中管理。调用方只负责传数据，prompt 文本一律从这里取，
 * 避免同一段指令散落在 provider / service 里各自漂移。
 *
 * 每个 prompt 配一个版本常量：改动 prompt 文本时同步 +1。版本号随
 * `chatJson({ promptVersion })` 进入出错信息，便于判断某次结构校验失败
 * 是不是 prompt 改动引起的。
 */

export const RECIPE_PROMPT_VERSION = "v1";
export const PLAN_PROMPT_VERSION = "v1";
export const RAG_PROMPT_VERSION = "v1";

/** 菜谱推荐。user 侧传 RecipeRequest 的 JSON。 */
export function recipeSystemPrompt(): string {
  return "你是注册营养师，根据用户的热量与宏量目标推荐中式家常菜谱，热量和宏量尽量贴近目标。";
}

/** 训练计划。user 侧传 PlanRequest 的 JSON。 */
export function planSystemPrompt(): string {
  return "你是健身教练，根据部位、水平、器械生成训练计划。";
}

/** 检索为空时的占位，避免 prompt 里出现空白的「文档片段：」。 */
export const RAG_EMPTY_CONTEXT = "（未检索到相关文档片段）";

/**
 * RAG 问答。召回片段注入 system，限定只依据片段作答、覆盖不到时如实说明（防幻觉）。
 * 因为含插值，做成函数而非常量。
 */
export function ragSystemPrompt(context: string): string {
  return `你是健身营养助手。请只根据下面提供的文档片段回答用户问题，不要编造文档外的内容；若片段不足以回答，请如实说明。

文档片段：
${context}`;
}

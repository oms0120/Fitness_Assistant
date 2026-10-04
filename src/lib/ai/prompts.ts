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

export const JUDGE_PROMPT_VERSION = "v1";

/**
 * 答案侧评审（LLM-as-judge）。**只在 `scripts/eval-answer.ts` 里用，不在线上链路里。**
 *
 * 两条判据的分工：faithfulness 管「有没有编」，relevance 管「有没有答到点上」。
 * 刻意不让评委用自己的领域知识去核对事实对错 —— 那是正确性，不是忠实性；
 * 两者混在一个分数里，指标就失去指向性，看不出该改检索还是改 prompt。
 *
 * 片段不足时如实说明必须记高分：否则正确的拒答会被判成不忠实，进而逼着模型
 * 「宁可编也要答」，与 ragSystemPrompt 的防幻觉约束直接冲突。
 */
export function judgeSystemPrompt(): string {
  return `你是 RAG 问答系统的评审员。只根据下面给出的「文档片段」「用户问题」「系统回答」打分，不要用你自己的领域知识去判断回答对不对 —— 你评估的是回答有没有依据、有没有答到点上，不是它是否符合事实。

faithfulness（1-5）：回答是否**只依据**文档片段。
  5 = 每一处事实陈述都能在片段里找到原文依据
  4 = 主体有依据，个别概括或措辞略有外推，不影响事实
  3 = 主要结论有依据，但夹带了片段里没有的具体信息（数字、名称、因果）
  2 = 部分结论在片段里找不到依据
  1 = 基本来自片段之外，或与片段矛盾
  若片段本身不足以回答，而回答如实说明了这一点，faithfulness 记 5。

relevance（1-5）：回答是否切题。
  5 = 直接、完整地回答了问题
  4 = 回答了，但冗长，或遗漏了次要部分
  3 = 沾边，没有正面回答
  2 = 大部分跑题
  1 = 与问题无关
  片段不足时如实说明「无法回答」，是在给定片段下对这个问题唯一正确的回应，记 5。

reasoning 用一两句话说明这两分的依据，指出具体是哪一句有问题（若有）。`;
}

/** 评审的 user 侧。context 必须与生成时注入的上下文逐字一致（用 ragService 的 formatChunks 渲染）。 */
export function judgeUserPrompt({
  question,
  answer,
  context,
}: {
  question: string;
  answer: string;
  context: string;
}): string {
  return `【文档片段】
${context}

【用户问题】
${question}

【系统回答】
${answer}`;
}

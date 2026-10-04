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

export const JUDGE_PROMPT_VERSION = "v2";

/**
 * 答案侧评审（LLM-as-judge）。**只在 `scripts/eval-answer.ts` 里用，不在线上链路里。**
 *
 * 三条判据各管一件事，**互不代偿**：
 *   faithfulness  有没有编     —— 回答里的事实是否都能在片段里找到
 *   relevance     有没有跑题   —— 回答是否还在问题所问的这件事上
 *   sufficiency   有没有真的回答 —— 用户读完能不能拿到他要的信息
 *
 * 拆出 sufficiency 是因为 v1 只有前两条时，**「检索失败」这个失败模式是不可见的**：
 * 片段不足时模型如实说「无法回答」，在 v1 的两条判据下都是满分（faithfulness 没编、
 * relevance 切题），于是测得 faithfulness 4.98 / relevance 4.97 全是满分，
 * 而弃答率其实是「召回命中 2% vs 未命中 26%」——12 倍的差别被抹平。
 * 现在这条路径的正确记分是 **5 / 5 / 1**：没编、没跑题、但没回答。
 *
 * 刻意不让评委用领域知识核对事实对错 —— 那是正确性，不是忠实性；混进同一个分数里，
 * 指标就失去指向性，看不出该改检索还是改 prompt。同理，片段不足时的如实说明
 * **在 faithfulness 上**必须记满分：否则正确的拒答被判成不忠实，会逼着模型
 * 「宁可编也要答」，与 ragSystemPrompt 的防幻觉约束直接冲突。——它的代价记在 sufficiency 上，
 * 不在 faithfulness 上。
 */
export function judgeSystemPrompt(): string {
  return `你是 RAG 问答系统的评审员。只根据下面给出的「文档片段」「用户问题」「系统回答」打分，不要用你自己的领域知识去判断回答对不对 —— 你评估的是回答有没有依据、有没有答到点上、有没有真的回答问题，不是它是否符合事实。

三个分数相互独立，不要因为一个高就顺手把另一个也打高。

faithfulness（1-5）：回答是否**只依据**文档片段。
  5 = 每一处事实陈述都能在片段里找到原文依据
  4 = 主体有依据，个别概括或措辞略有外推，不影响事实
  3 = 主要结论有依据，但夹带了片段里没有的具体信息（数字、名称、因果）
  2 = 部分结论在片段里找不到依据
  1 = 基本来自片段之外，或与片段矛盾
  若片段本身不足以回答，而回答如实说明了这一点，faithfulness 记 5（它确实没编）。这不代表回答有用——有没有用记在 sufficiency 上，别在这一项上体现。

relevance（1-5）：回答是否还在问题所问的这件事上。**只看有没有跑题，不看答得全不全。**
  5 = 完全在问题上，没有跑题内容
  4 = 主体在问题上，夹了少量无关内容
  3 = 一半在问题上
  2 = 大部分是无关内容
  1 = 与问题无关
  如实说明「无法回答」，本身仍是在回应这个问题，relevance 记 5。答得全不全不在这一项。

sufficiency（1-5）：回答是否真的给出了用户要的信息。**这是唯一衡量「有没有用」的分。**
  5 = 用户读完就能拿到问题所问的信息，不需要再查别处
  4 = 给了主要信息，有次要缺口
  3 = 只答了一半，关键的那部分缺失
  2 = 沾边，但没有给出所要的信息
  1 = 没有回答：如实说明无法回答、或答非所问
  答得又长又全、但没碰到问题真正要的那一点，是 2 不是 4。

reasoning 用一两句话说明这三个分的依据，指出具体是哪一句有问题（若有）。`;
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

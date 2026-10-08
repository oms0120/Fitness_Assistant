import { logger } from "@/lib/logger";
import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import type { AiProvider } from "./provider";

/**
 * 模型异常兜底：`primary` 抛异常时整个转给 `fallback`（规则库）。
 *
 * docs/README.md 的「关键设计」第 3 条写的是**三级降级**：无 key → 规则库；
 * 模型异常 → 规则库；检索服务离线 → 无上下文问答。前两级和第三级此前都成立，
 * **只有「模型异常 → 规则库」是漏的** —— 两个 AI 路由各自 catch 成 500
 * （`ai/recipes` / `ai/plan` 的路由），规则库明明已经注入在 `getProvider()` 里却没人用。
 * 于是上游 4xx/5xx、断网、超时都会把整页打成「AI 生成失败」，而仓库里躺着一份
 * 现成的规则库产出。这个类补的就是这一格。
 *
 * ## 为什么单独一个类，而不是在路由里 catch
 *
 * 同 `guardedProvider.ts` 的理由：路由只知道「这次请求该有个结果」，不该知道
 * 「模型挂了要拿什么顶上」。放这儿还能脱离 DB 和网络单测 —— 两个假 provider 就够。
 *
 * ## 为什么套在 `BudgetGuardedProvider` **外面**
 *
 * 预算判定要发生在花钱之前，模型调用失败只可能发生在花钱之后，所以
 * `ErrorFallback( BudgetGuarded( Llm, Rule ) )` 这个顺序下两个兜底各管一段，
 * 互不干扰。反过来套的话得改 `guardedProvider.ts` 的 `degraded` 取值 ——
 * 那份代码有测试覆盖，没必要为这个动它。
 *
 * 代价是 `degraded` 要把**内层**的也算上（超预算时是内层降的级，异常时是本层），
 * 见下面 getter。
 *
 * ## 为什么要 warn 而不是静默
 *
 * 降级后路由返回 200，异常不再冒到路由的 catch —— 这条 warn 是**这次故障唯一的痕迹**。
 * `degraded` 字段虽然也带在响应体里，但那个字段到浏览器就没了
 * （同 `guardedProvider.ts` 里那句注释）。所以 `err` 必须一起打出来：
 * 上游 500、连不上、schema 不匹配的处理方式完全不同。
 */
export class ErrorFallbackProvider implements AiProvider {
  /** 每次调用重置，语义与 `BudgetGuardedProvider` 一致：反映**最近一次**调用。 */
  private usedFallback = false;

  constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider,
    /** 只进日志 —— 那条 warn 要靠它和同一次请求的其他日志串起来。 */
    private readonly requestId?: string,
  ) {}

  /**
   * 本次结果是不是降级来的。路由据此在响应里带 `degraded`。
   *
   * 必须 `|| primary.degraded`：超预算是**内层** `BudgetGuardedProvider` 降的级，
   * 它不抛异常，所以本层的 `usedFallback` 一直是 false —— 只看自己就会把
   * 「额度用完吃了模板」报成 `degraded: false`。
   */
  get degraded(): boolean {
    return this.usedFallback || (this.primary.degraded ?? false);
  }

  /**
   * `fn` 收 provider 而不是收结果，是为了让**两个能力共用**这一套 try/catch，
   * 而不是各抄一遍 —— 抄的那份迟早漏掉 `usedFallback = false` 的重置。
   *
   * 兜底**不再包 try**：`RuleProvider` 匹配不到时返回空数组而不是抛错
   * （`ruleProvider.ts` 的 `if (!plan) return []`），所以它自己失败的概率极低；
   * 真失败了就让异常冒出去 —— 那时已经没有任何东西能顶上，吞掉只会变成静默的空白页。
   */
  private async run<T>(fn: (provider: AiProvider) => Promise<T>): Promise<T> {
    this.usedFallback = false;
    try {
      return await fn(this.primary);
    } catch (err) {
      this.usedFallback = true;
      logger.warn({ err, requestId: this.requestId }, "[ai] 模型调用失败，本次降级到规则库");
      return fn(this.fallback);
    }
  }

  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    return this.run((p) => p.recommendRecipes(input));
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    return this.run((p) => p.generatePlan(input));
  }
}

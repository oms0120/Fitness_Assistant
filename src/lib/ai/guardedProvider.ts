import { logger } from "@/lib/logger";
import type { RecipeRequest, PlanRequest, RecipeSuggestion, PlanSuggestion } from "./types";
import type { AiProvider } from "./provider";

/**
 * 预算守卫：花钱前先问 `canSpend`，不能花就整个转给 `fallback`。
 *
 * 为什么单独一个类、而不是在 `LlmProvider` 里 catch：
 *   - `LlmProvider` 不该知道规则库的存在 —— LLM 适配器知道自己的降级方案是依赖倒置。
 *   - 内联进去就得直接读 DB，那样它就没法脱离数据库测试。
 *
 * 判定用**注入的谓词**而不是直接查 Prisma，于是两个假 provider + 一个假布尔
 * 就能把三条分支都测了。这正是这个抽象存在的全部理由 —— 测不了就说明抽象错了。
 *
 * 谓词自己负责 fail-open（见 `usage.ts` 的 `canSpend`）。这里再兜一层：
 * 谓词抛异常时按「能花钱」处理，因为预算库抖一下就让全站降级到模板，比超支一天更糟。
 */
export class BudgetGuardedProvider implements AiProvider {
  /** 每个请求新建一个实例（`getProvider()` 在路由里调用），所以这个状态没有跨请求竞争。 */
  private usedFallback = false;

  constructor(
    private readonly primary: AiProvider,
    private readonly fallback: AiProvider,
    private readonly canSpend: () => Promise<boolean>,
  ) {}

  /** 这次结果是不是降级来的。路由据此在响应里带 `degraded`。 */
  get degraded(): boolean {
    return this.usedFallback;
  }

  private async pick(): Promise<AiProvider> {
    let allowed: boolean;
    try {
      allowed = await this.canSpend();
    } catch (err) {
      logger.error({ err }, "[ai] 预算判定失败，本次走模型");
      allowed = true;
    }
    this.usedFallback = !allowed;
    return allowed ? this.primary : this.fallback;
  }

  async recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]> {
    return (await this.pick()).recommendRecipes(input);
  }

  async generatePlan(input: PlanRequest): Promise<PlanSuggestion> {
    return (await this.pick()).generatePlan(input);
  }
}

# LLM 增强 设计

> 日期：2026-08-16
> 状态：待审查

## Context

需求 4/6 已用规则库（菜谱库、训练计划模板）实现。本阶段接入 Claude 提供个性化 AI 生成能力，作为规则库的增强。默认回退规则库，配了 API key 才启用 AI。

## 已确认决策

- **范围**：菜谱推荐 + 训练计划，两者都做
- **API 配置**：先搭架构（ClaudeProvider 代码 + 开关），key 后续配；未配 key 时静默回退规则库

## 技术栈新增

- `@anthropic-ai/sdk`（Anthropic 官方 SDK）
- 模型：`claude-opus-5`，`thinking: {type: "adaptive"}`
- 结构化输出：`client.messages.parse()` + `zodOutputFormat()`

## 架构（`src/lib/ai/`）

```
src/lib/ai/
  types.ts          # AI 输出的 zod schema（菜谱建议、训练计划建议）
  provider.ts       # AiProvider 接口 + getProvider() 开关
  ruleProvider.ts   # 规则库实现（读 recipes.ts / planTemplates.ts，默认）
  claudeProvider.ts # Claude 实现（@anthropic-ai/sdk）
```

### provider.ts

```ts
export interface AiProvider {
  recommendRecipes(input: RecipeRequest): Promise<RecipeSuggestion[]>;
  generatePlan(input: PlanRequest): Promise<PlanSuggestion>;
}

export function getProvider(): AiProvider {
  const mode = process.env.AI_PROVIDER;
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (mode === "claude" && hasKey) return new ClaudeProvider();
  return new RuleProvider(); // 默认 + 无 key 时回退
}
```

### claudeProvider.ts

```ts
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

const client = new Anthropic(); // 从 ANTHROPIC_API_KEY 环境变量读

async recommendRecipes(input) {
  const response = await client.messages.parse({
    model: "claude-opus-5",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: "你是一名注册营养师，根据用户的营养目标推荐中式家常菜谱。",
    messages: [{ role: "user", content: JSON.stringify(input) }],
    output_config: { format: zodOutputFormat(recipeSuggestionsSchema) },
  });
  return response.parsed_output?.suggestions ?? [];
}
```

### 输出 schema（types.ts）

```ts
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
export const recipeSuggestionsSchema = z.object({ suggestions: z.array(recipeSuggestionSchema) });

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
```

## API（server 端调 Claude，避免暴露 key）

- `POST /api/ai/recipes`：body `{ targetCalories, proteinRatio, carbRatio, fatRatio, goal }` → `{ suggestions }`
- `POST /api/ai/plan`：body `{ muscleGroup, level, equipment }` → `{ plan }`
- 调 `getProvider()`，返回 provider 结果；无 key 时返回规则库结果（用户无感知）

## UI

- `/meals` 页：加「AI 推荐菜谱」按钮，调 `/api/ai/recipes`，展示建议
- `/plans` 页：登录后加「AI 生成计划」按钮，调 `/api/ai/plan`，展示计划

## 环境变量（`.env`，key 后续配）

```
AI_PROVIDER="claude"        # rule | claude；不设默认 rule
ANTHROPIC_API_KEY="sk-..."  # 未配置时静默回退规则库
```

## 约定

- API key 只在 server 端使用（API route），绝不暴露到客户端
- 无 key 时 `getProvider()` 返回 RuleProvider，AI 按钮仍可用但返回规则库结果
- Claude 生成内容标注「AI 生成，仅供参考」

## 非目标（YAGNI）

- 流式输出（菜谱/计划生成量小，非流式够用）
- 多轮对话/上下文记忆
- 自定义模型选择（固定 claude-opus-5）
- 生成结果持久化

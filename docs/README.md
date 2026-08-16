# 智能健身助手

一个基于 Web 的智能健身助手，覆盖身体代谢计算、体脂测量、营养方案、膳食推荐与训练计划。

## 功能清单

1. 根据身体参数计算基础代谢（BMR），结合运动强度计算每日总代谢（TDEE）
2. 通过美国海军体脂测量法计算体脂率
3. 根据减脂/增肌方案计算每日碳水、蛋白质、脂肪摄入
4. 依《中国居民膳食指南》推荐菜谱
5. 建立胸、肩、背、腿、臂动作库
6. 提供分部位训练动作与计划
7. 提供重量（1RM）计算器、FFMI 计算器

---

## 技术栈选型

| 层 | 选型 | 理由 |
|---|---|---|
| 全栈框架 | **Next.js 15 (App Router) + React 19 + TypeScript** | 单代码库前后端一体、API Routes 天然提供后端、类型全栈共享，个人项目部署最省心 |
| UI | **Tailwind CSS + shadcn/ui** | 快速出成品、风格统一 |
| 后端 | Next.js Route Handlers + Zod 校验 | 无需单独后端框架，配合 Server Actions 做表单提交 |
| ORM | **Prisma** | schema 即文档、迁移/类型生成一体，DX 最好 |
| 数据库 | **PostgreSQL**（本地 Docker Compose） | 多用户/账户/历史记录需要真 RDBMS；JSONB 灵活存扩展字段 |
| 认证 | **Auth.js (NextAuth v5)** | Credentials + 后续可加 OAuth |
| AI（可选） | **Vercel AI SDK + Claude**（`claude-sonnet-5`） | 菜谱/计划增强，环境变量开关控制，默认走规则库 |
| 测试 | Vitest（公式单测）+ 可选 Playwright E2E | 计算公式必须单测锁定正确性 |
| 部署 | Docker Compose（本地）；后续 Vercel + 托管 PG | 分阶段 |

> 备选：若日后想脱离框架锁定的 Server Actions，可平滑引入 tRPC；数据库最省事可换 SQLite，但多用户并发场景 PostgreSQL 更稳，故直接定 PG。

---

## 系统架构

### 分层

```
┌─────────────────────────────────────────────┐
│  UI 层  app/(pages) + components            │  表单/结果展示/图表
├─────────────────────────────────────────────┤
│  API 层  app/api/* Route Handlers           │  认证、账户、日志读写
├─────────────────────────────────────────────┤
│  Service 层  server/services/*              │  业务编排（组合计算与规则库）
├─────────────────────────────────────────────┤
│  领域层  lib/calculators + lib/data         │  纯计算函数 + 规则库数据
├─────────────────────────────────────────────┤
│  数据层  Prisma + PostgreSQL                │  User/Profile/Recipe/Exercise...
└─────────────────────────────────────────────┘
```

核心原则：**计算公式、规则库数据与 UI/服务层解耦**，做成纯函数与纯数据，保证可单测、可复用。

### 目录结构

```
src/
  app/
    (marketing)/page.tsx          # 落地页/免责声明
    (auth)/login  register        # 登录注册
    (dashboard)/                  # 登录后主应用
      calculators/                # 计算器页（可未登录即用）
      exercises/  plans/  meals/  # 动作库/计划/菜谱
      profile/  history/          # 身体档案/历史记录
    api/auth/[...nextauth]        # 认证
    api/profile  api/logs  api/plans  api/ai/...   # 业务 API
  components/                     # UI 组件（表单/结果卡片/图表）
  lib/
    calculators/
      bmr.ts  tdee.ts  bodyFat.ts  macros.ts  ffmi.ts  oneRm.ts
      index.ts                    # 统一入口 + zod 输入 schema
    data/
      exercises.ts  recipes.ts  mealPlans.ts  activityLevels.ts
    db/prisma.ts                  # Prisma 单例
    ai/provider.ts                # LLM 接口抽象 + 规则库默认实现
  server/services/                # 业务编排
  types/                          # 共享 TS 类型
prisma/schema.prisma
```

---

## 核心计算模块（纯函数，Vitest 锁定）

| 模块 | 公式/来源 | 输入 |
|---|---|---|
| `bmr.ts` | Mifflin-St Jeor：男 `10W + 6.25H − 5A + 5`；女 `10W + 6.25H − 5A − 161` | 性别/体重kg/身高cm/年龄 |
| `tdee.ts` | BMR × 活动系数（1.2/1.375/1.55/1.725/1.9） | BMR + 活动水平 |
| `bodyFat.ts` | 美国海军法（cm）：男 `495/(1.0324−0.19077·log10(腰−颈)+0.15456·log10(身高))−450`；女 `495/(1.29579−0.35004·log10(腰+臀−颈)+0.22100·log10(身高))−450` | 身高/颈围/腰围(+臀围女) |
| `macros.ts` | 减脂缺口 10–20%、增肌盈余 5–10%；蛋白 1.6–2.2 g/kg；脂肪 20–35% 总热；碳水补足 | TDEE + 目标 + 体重 |
| `ffmi.ts` | 瘦体重 = 体重×(1−体脂率)；FFMI = 瘦体重/身高(m)²；标准化修正 `+6.1×(1.8−身高m)` | 体重/体脂率/身高 |
| `oneRm.ts` | Epley `W×(1+reps/30)`；Brzycki `W×36/(37−reps)` | 重量 + 次数 |

每个模块配 zod 输入 schema，非法输入（身高为 0、腰围 < 颈围等）返回结构化错误而非抛异常。

---

## 规则库设计（`lib/data/`）

- `exercises.ts`：动作库，字段含 `id / name / muscleGroup(胸肩背腿臂) / equipment / difficulty / instructions / 图片URL占位`
- `recipes.ts`：依《中国居民膳食指南》整理的菜谱，字段含 `id / name / category(减脂/增肌/均衡) / calories / protein / carbs / fat / ingredients / steps / tags`
- `mealPlans.ts`：按目标 + 热量档的模板组合
- `activityLevels.ts`：活动系数表

规则库用 TS 常量文件（类型安全、可 import、易迁移到 DB）。菜谱推荐逻辑 = 按用户热量/宏量目标 + 目标类型从 `recipes.ts` 匹配打分排序。

---

## LLM 增强（可选，默认关闭）

`lib/ai/provider.ts` 定义接口：

```ts
interface RecipeProvider {
  recommend(context: UserMacroContext): Promise<RecipeSuggestion[]>;
}
```

- `RuleBasedProvider`（默认）：读 `recipes.ts` 匹配
- `ClaudeProvider`（可选）：Vercel AI SDK 调 `claude-sonnet-5` 生成个性化菜谱/计划
- 用环境变量 `AI_PROVIDER=rule|claude` + `ANTHROPIC_API_KEY` 切换，未配置时静默回退规则库

---

## 数据模型（Prisma）

```prisma
model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  profiles     Profile[]
  logs         Log[]
  createdAt    DateTime @default(now())
}
model Profile {          // 身体档案，可多条做历史
  id        String  @id @default(cuid())
  userId    String
  sex       Sex
  heightCm  Float
  weightKg  Float
  neckCm    Float
  waistCm   Float
  hipCm     Float?
  age       Int
  goal      Goal
  activity  ActivityLevel
  createdAt DateTime @default(now())
}
model Log {              // 计算结果/训练记录快照
  id        String   @id @default(cuid())
  userId    String
  type      String       // bmr/bodyfat/macros/ffmi/onerm/workout
  data      Json         // 输入+结果快照
  createdAt DateTime @default(now())
}
enum Sex { MALE FEMALE }
enum Goal { CUT BULK MAINTAIN }
enum ActivityLevel { SEDENTARY LIGHT MODERATE HIGH EXTREME }
```

动作库与菜谱库初期存 `lib/data/` 静态文件（学习项目够用），后续要支持用户自定义/管理时再建 `Exercise`、`Recipe` 表。

---

## 实施路线图（MVP 优先）

- **阶段 0：脚手架** — Next.js + TS + Tailwind + shadcn/ui 初始化；Docker Compose 起 PostgreSQL；Prisma 初始化；git init
- **阶段 1：核心计算器**（无需登录）— 实现 `lib/calculators/*` 6 个纯函数 + zod schema + Vitest 单测；计算器页（BMR/TDEE、体脂率、宏量营养、FFMI、1RM）覆盖需求 1、2、3、7
- **阶段 2：规则库 + 菜谱/动作/计划** — `lib/data/*` 数据 + 菜谱匹配推荐；动作库分部位筛选页；训练计划模板页，覆盖需求 4、5、6
- **阶段 3：后端持久化** — Prisma schema + 迁移；Auth.js 账户体系；Profile/Log 读写 API；历史记录页
- **阶段 4：可选 LLM 增强** — `lib/ai/provider.ts` 抽象 + ClaudeProvider；`AI_PROVIDER` 开关

---

## 免责声明

本工具的计算结果与推荐内容均为参考信息，不构成医疗或营养建议。减脂/增肌方案请结合自身健康状况，必要时咨询专业医师或营养师。

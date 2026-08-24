# 智能健身助手

一个基于 Web 的智能健身助手，覆盖身体代谢计算、体脂测量、营养方案、膳食推荐、训练计划与 RAG 知识问答。

> 本文档反映**当前实现**（截至 2026-08）。`docs/superpowers/` 下是开发早期的计划与规格快照，仅作历史参考，与最终实现可能有出入。

## 功能清单

1. 根据身体参数计算基础代谢（BMR），结合运动强度计算每日总代谢（TDEE）
2. 通过美国海军体脂测量法计算体脂率
3. 根据减脂/增肌/维持方案计算每日碳水、蛋白质、脂肪摄入（支持高级参数覆盖）
4. 依《中国居民膳食指南》推荐菜谱，支持按热量匹配单品与组合三餐
5. 建立胸、肩、背、腿、臂动作库，提供分部位训练计划模板
6. 提供 1RM、FFMI 计算器
7. 账户体系：注册登录、身体档案、计算历史、训练计划云端同步
8. RAG 知识问答：基于本地语料（膳食指南、力量训练基础）的带出处问答

---

## 技术栈选型

| 层 | 选型 | 理由 |
|---|---|---|
| 全栈框架 | **Next.js 16 (App Router) + React 19 + TypeScript** | 单代码库前后端一体、API Routes 提供后端、类型全栈共享 |
| UI | **Tailwind CSS v4 + shadcn/ui** | 快速出成品、风格统一 |
| ORM | **Prisma** | schema 即文档、迁移/类型生成一体 |
| 数据库 | **SQLite** | 个人项目单用户，无需独立 DB 服务；Prisma 迁移极简，`file:./dev.db` 即可 |
| 认证 | **Auth.js v5**（邮箱密码 + JWT session） | Credentials 方式，AI 接口鉴权 |
| LLM | **@anthropic-ai/sdk（`claude-opus-5`）+ DeepSeek**，官方 SDK 直连 | 双后端统一抽象，不引入 Vercel AI SDK 层 |
| RAG | **Ollama + bge-m3**（1024 维）+ **FastAPI** 检索服务 | embedding 全本地、无 API 成本；Python 生态做向量化更顺手 |
| 测试 | Vitest（公式/匹配算法单测） | 计算公式必须单测锁定正确性 |

> 与早期设计（PostgreSQL + Docker Compose + Vercel AI SDK + `claude-sonnet-5`）的差异：数据库最终选了 SQLite（单用户无需 PG），AI 层改为官方 SDK 直连并新增 DeepSeek 与 RAG。

---

## 系统架构

### 分层

```
┌─────────────────────────────────────────────┐
│  UI 层  app/(pages) + components            │  表单/结果展示
├─────────────────────────────────────────────┤
│  API 层  app/api/* Route Handlers           │  认证、档案、日志、AI、RAG 问答
├─────────────────────────────────────────────┤
│  领域层  lib/calculators + lib/data         │  纯计算函数 + 规则库数据
│         lib/ai（LLM 接入层）                 │  双后端抽象 + 规则回退
│         lib/rag（RAG 客户端）                │  检索调用 + 问答生成
├─────────────────────────────────────────────┤
│  数据层  Prisma + SQLite                    │  User/Profile/Log/TrainingPlan
├─────────────────────────────────────────────┤
│  检索层  rag-service/（FastAPI，独立进程）    │  Ollama bge-m3 向量化 + 余弦相似度检索
└─────────────────────────────────────────────┘
```

核心原则：**计算公式、规则库数据与 UI 解耦**，做成纯函数与纯数据，保证可单测、可复用；**embedding 走独立 Python 服务**，与 Next.js 进程分离。

### 目录结构

```
src/
  app/
    (auth)/login  register          # 登录注册
    ask/                             # RAG 问答页
    calculators/{bmr,body-fat,ffmi,macros,one-rm}/  # 计算器
    exercises/  plans/  meals/       # 动作库/训练计划/菜谱
    history/  profile/               # 历史记录/身体档案
    api/
      auth/[...nextauth]             # 认证
      ai/{plan,recipes}/             # AI 菜谱/计划
      rag/ask/                       # RAG 问答
      profile/  logs/  register/  training-plan/
  components/                        # UI 组件
  lib/
    calculators/{bmr,tdee,bodyFat,macros,ffmi,oneRm,result,types}.ts
    data/{exercises,recipes,plans,types}.ts   # 规则库
    ai/{llm,llmProvider,deepseekProvider,claudeProvider,ruleProvider,provider,types}.ts
    rag/{ragClient,ragService}.ts    # RAG 客户端与问答
    db/prisma.ts                     # Prisma 单例
    mealMatching.ts  mealPlanMatching.ts  logFormat.ts  utils.ts
prisma/schema.prisma
rag-service/                         # Python RAG 服务（独立进程）
  embedding.py  server.py  ingest.py  ocr.py  data/vectors.db
```

---

## 核心计算模块（纯函数，Vitest 锁定）

| 模块 | 公式/来源 | 输入 |
|---|---|---|
| `bmr.ts` | Mifflin-St Jeor：男 `10W + 6.25H − 5A + 5`；女 `10W + 6.25H − 5A − 161` | 性别/体重kg/身高cm/年龄 |
| `tdee.ts` | BMR × 活动系数（1.2/1.375/1.55/1.725/1.9） | BMR + 活动水平 |
| `bodyFat.ts` | 美国海军法（cm）：男 `495/(1.0324−0.19077·log10(腰−颈)+0.15456·log10(身高))−450`；女 `495/(1.29579−0.35004·log10(腰+臀−颈)+0.22100·log10(身高))−450` | 身高/颈围/腰围(+臀围女) |
| `macros.ts` | 热量系数：减脂 0.8 / 增肌 1.1 / 维持 1.0；蛋白 2.2 / 1.8 / 1.8 g/kg；脂肪 25% 总热；碳水补足（≥0） | TDEE + 目标 + 体重 |
| `ffmi.ts` | 瘦体重 = 体重×(1−体脂率)；FFMI = 瘦体重/身高(m)²；标准化修正 `+6.1×(1.8−身高m)` | 体重/体脂率/身高 |
| `oneRm.ts` | Epley `W×(1+reps/30)`；Brzycki `W×36/(37−reps)` | 重量 + 次数 |

宏量默认值均可通过高级设置覆盖（热量系数 0.5–1.5、蛋白 0.8–3.5 g/kg、脂肪 15–40%）。

每个模块配 zod 输入 schema，非法输入返回**判别联合类型** `{ok, data|errors}` 而非抛异常；体脂公式用 `superRefine` 施加跨字段约束（男性腰围须大于颈围、女性须提供臀围且腰臀和大于颈围），在进入对数运算前拦截会产生 NaN 的非法组合。

---

## 规则库设计（`lib/data/`）

- `exercises.ts`：动作库（20 个），按 `muscleGroup`（胸/肩/背/腿/臂）分类
- `recipes.ts`：依《中国居民膳食指南》整理的菜谱（14 个），含 `category`（cut/bulk/balanced）与 `mealType`（breakfast/meal）
- `plans.ts`：分部位训练计划模板（5 套）

规则库用 TS 常量文件（类型安全、可 import）。菜谱推荐：按热量匹配单品，或组合三餐在「早餐 × 正餐 × 正餐」笛卡尔积上以四维归一化偏差之和求最优（`mealPlanMatching.ts`）。

---

## AI 接入层（`lib/ai/`）

统一入口 `chatJson({ system, user, schema })`，按 `AI_PROVIDER` 或已配置的 key 分发：

- **`ruleProvider`**（默认回退）：读本地规则库匹配，无 LLM 依赖
- **`deepseekProvider`**：OpenAI 兼容 `/chat/completions`，`json_object` 模式 + `z.toJSONSchema()` 注入 prompt + 二次 zod 校验
- **`claudeProvider`**：官方 SDK `messages.parse` + `output_config.format`（`zodOutputFormat`），结构由 API 侧保证

关键设计：

1. **schema 单一事实源**：同一份 zod schema 既校验表单输入，又约束模型输出，还经 `z.toJSONSchema()` 复用为 prompt 约束，避免类型定义与 prompt 漂移。
2. **双后端抹平能力差异**：Claude 原生保证结构，DeepSeek 仅保证合法 JSON，故 DeepSeek 分支额外做 schema 注入 + 二次校验。
3. **三级降级**：无 key → 规则库；模型异常 → 规则库；检索服务离线 → 无上下文问答。任一依赖故障不阻断主流程。
4. **惰性加载**：后端用动态 `import()`，未配置的厂商 SDK 不进入运行时。

---

## RAG 检索服务（`rag-service/`，独立 Python 进程）

- **`ocr.py`**：RapidOCR（ONNX Runtime）从扫描版 PDF 提取语料
- **`ingest.py`**：清洗 → 切块（段落边界优先，超长段落 400 字滑窗 + 50 字重叠）→ 批量调 Ollama bge-m3 生成 1024 维向量 → 存 SQLite `vectors.db`
- **`server.py`**：FastAPI 暴露 `/embed` 与 `/search`；检索做 L2 归一化后以点积等价余弦相似度做 Top-K，并对向量库维度做校验（换模型后旧索引报错而非静默出错）
- **`embedding.py`**：Ollama `/api/embed` 客户端，`server.py` 与 `ingest.py` 共用

语料：`data/力量训练基础.txt` + `data/dietary_guide.txt`（约 1.6MB），共 1739 个片段。

前端侧 `src/lib/rag/`：`ragClient.ts` 调 `/search`（服务不可用返回空数组），`ragService.ts` 的 `askWithRag` 完成「检索 → 注入 prompt → 生成 → 返回出处」，prompt 限定模型仅依据召回片段作答、语料未覆盖时如实说明（防幻觉）。

---

## 数据模型（Prisma）

```prisma
model User {
  id           String         @id @default(cuid())
  email        String         @unique
  passwordHash String
  trainingPlan TrainingPlan?
  profiles     Profile[]
  logs         Log[]
  createdAt    DateTime       @default(now())
}
model Profile {          // 身体档案，可多条
  id        String   @id @default(cuid())
  userId    String
  sex       String
  heightCm  Float
  weightKg  Float
  neckCm    Float
  waistCm   Float
  hipCm     Float?
  age       Int
  goal      String
  activity  String
  createdAt DateTime @default(now())
}
model Log {              // 计算结果快照（data 存 JSON 字符串）
  id        String   @id @default(cuid())
  userId    String
  type      String
  data      String
  createdAt DateTime @default(now())
}
model TrainingPlan {     // 用户训练计划，一人一份
  id        String   @id @default(cuid())
  userId    String   @unique
  data      String
  updatedAt DateTime @updatedAt
}
```

动作库与菜谱库存 `lib/data/` 静态文件，无需入表。

---

## 测试

Vitest 覆盖全部计算模块（BMR/TDEE/体脂/宏量/FFMI/1RM）、配餐匹配算法与规则库，共 32 个用例。运行：`npm test`。

---

## 免责声明

本工具的计算结果与推荐内容均为参考信息，不构成医疗或营养建议。减脂/增肌方案请结合自身健康状况，必要时咨询专业医师或营养师。

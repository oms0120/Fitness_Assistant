# 智能健身助手

一个基于 Web 的智能健身助手，覆盖身体代谢计算、体脂测量、营养方案、膳食推荐与训练计划。

## 功能

- **计算器**：基础代谢（BMR）/ 每日总代谢（TDEE）、美国海军体脂率、宏量营养（减脂/增肌/维持，含高级设置）、FFMI、1RM
- **动作库**：胸 / 肩 / 背 / 腿 / 臂动作，按部位筛选
- **训练计划**：分部位预设模板，可改组数/次数、增删动作，登录后云端同步
- **菜谱库**：减脂/增肌/均衡分类浏览、按热量匹配单食谱、组合配餐（早/午/晚 3 餐），支持 AI 推荐
- **账户**：注册/登录、身体档案、计算历史记录

## 技术栈

- Next.js 16 (App Router) + React 19 + TypeScript
- Tailwind CSS v4 + shadcn/ui
- Prisma + SQLite
- Auth.js v5（邮箱密码 + JWT session）
- AI 接入层支持 DeepSeek 与 Claude（`@anthropic-ai/sdk`，`claude-opus-5`），未配 key 时回退本地规则库
- RAG 检索用本地 Ollama 的 bge-m3 embedding
- Vitest

## 快速开始

```bash
npm install
cp .env.example .env        # 配置 DATABASE_URL + AUTH_SECRET
npx prisma migrate dev      # 初始化数据库
npm run dev                 # 启动开发服务器
```

打开 http://localhost:3000

## RAG 问答服务（可选）

文档检索走 `rag-service/` 里的 Python 服务，embedding 由**本地 Ollama 的 bge-m3**（1024 维）提供，不需要联网也不需要 API key。

```bash
ollama serve                                    # 启动 Ollama（默认 127.0.0.1:11434）
ollama pull bge-m3                              # 拉取 embedding 模型（约 1.2GB，仅首次）

cd rag-service
# requirements.txt 是服务运行时依赖；requirements-tools.txt 是 ocr.py / ingest.py
# 这些一次性脚本的依赖（OCR 那套比较大，服务进程不需要）
.venv/Scripts/python -m pip install -r requirements.txt -r requirements-tools.txt
.venv/Scripts/python ingest.py                  # 把 data/*.txt 切块入库到 data/vectors.db
.venv/Scripts/python server.py                  # 检索服务监听 127.0.0.1:8000
```

换 embedding 模型后必须重跑 `ingest.py` 重建索引，否则 `/search` 会返回维度不一致的提示。Ollama 或向量库不可用时，前端会降级为"未检索到相关文档片段"，不会报错中断。

这条降级路径有个容易误判的坑：Ollama 默认空闲 5 分钟就卸载模型，之后再加载 `bge-m3`（1.1GB）实测要 4~22s，超过 Node 侧 `RAG_TIMEOUT_MS` 的 15s 默认值 —— 症状是**空闲后第一次问答丢掉全部出处、再问一次就正常**。`embedding.py` 因此在 embed 请求里带了 `keep_alive`（默认 `-1`，模型常驻），从源头消掉这个冷启动。想省内存就把 `OLLAMA_KEEP_ALIVE` 设成 `30m` 这类时长。

## Docker

整条链路（Next + 检索服务）一条命令起，Ollama 仍跑在宿主机上。

```bash
docker compose up --build
```

打开 http://localhost:3000（空库，先注册一个账号）。

| 服务 | 说明 |
|---|---|
| `migrate` | 一次性。对 `/data/dev.db` 跑 `prisma migrate deploy`，跑完即退 |
| `app` | Next.js standalone，端口 3000 |
| `rag` | FastAPI 检索服务，端口 8000 |

**前置**：`rag-service/data/vectors.db` 必须先存在 —— 它在 `.gitignore` 里，由宿主机的 `ingest.py` 生成（见上）。没有的话检索会返回"vectors.db 不存在"，前端降级成无上下文答案：问答能通，但**不给出处**。

两个卷策略不一样，是有意的：

- `app` 的 SQLite 用**命名卷** `app-db`。SQLite 跑在 Windows→Linux 的绑定挂载层上，锁和 WAL 有已知的不稳定风险，命名卷绕开这一层。
- `rag` 的 `data/` 用**绑定挂载 + 只读**。宿主是向量库的唯一事实来源，重新 `ingest.py` 之后容器立刻生效，不用重建镜像。

改 Python 依赖后要 `docker compose up --build rag`。改前端代码后 `docker compose up --build app`。容器内跑的是构建产物，不是热重载。

## AI 接入

菜谱推荐、训练计划、RAG 问答共用一层 LLM 抽象（[src/lib/ai/llm.ts](src/lib/ai/llm.ts)），prompt 与厂商无关，切换后端不用改业务代码。

| 模式 | 触发条件 | 行为 |
|---|---|---|
| `deepseek` | 配了 `DEEPSEEK_API_KEY` | OpenAI 兼容接口 + JSON Schema 注入 prompt，zod 二次校验 |
| `claude` | 配了 `ANTHROPIC_API_KEY` | 官方 SDK `messages.parse`，结构由 API 侧保证 |
| `rule` | 两个 key 都没配 | 菜谱/计划回退本地规则库；RAG 问答直接报错（无规则库可降级） |

不设 `AI_PROVIDER` 时按已配置的 key **自动探测**（DeepSeek 优先）；显式指定但缺对应 key 会降级回 `rule`。

## 环境变量

完整清单和可直接 `cp` 的样例见 [`.env.example`](.env.example)。下面按用途分组，每个变量都标了「不设时的默认值」。

**真实密钥只放在平台的环境变量面板里，不写进仓库。** `.env` 被 `.gitignore` 忽略（`.env*` + `!.env.example`），进版本库的只有 `.env.example`。

### 必填

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | SQLite 文件路径。相对路径按 `prisma/` 解析，`file:./dev.db` 落在 `prisma/dev.db` |
| `AUTH_SECRET` | Auth.js 会话签名密钥。**必须换成随机值**。本仓没装 `@auth/cli`，`npx auth secret` 用不了，用 `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` |

### AI 后端

| 变量 | 说明 |
|---|---|
| `AI_PROVIDER` | 可选，`deepseek` / `claude` / `rule`，留空则按 key 自动探测 |
| `DEEPSEEK_API_KEY` | DeepSeek key（配了即启用） |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `DEEPSEEK_TIMEOUT_MS` | 单次请求超时，默认 `60000` |
| `DEEPSEEK_RETRIES` | 失败重试次数，默认 `2` |
| `ANTHROPIC_API_KEY` | Claude key（配了即可用 `AI_PROVIDER=claude`） |
| `ANTHROPIC_BASE_URL` | 默认 `https://api.anthropic.com`（SDK 自带）。一般只在校验脚本里指向本地 mock |
| `ANTHROPIC_TIMEOUT_MS` | 单次请求超时，默认 `300000`。SDK 自己的默认是 10 分钟，对一次对话等于没上限，代码里显式封了顶 |
| `ANTHROPIC_MAX_RETRIES` | 默认 `2`。SDK 自带指数退避 + jitter，代码没有再套一层（否则尝试次数相乘） |

### 检索与 Ollama

后四个由 `rag-service` 自己读，不是 Next 应用读的（README 的 [RAG 一节](#rag-问答服务可选)有背景）。

| 变量 | 说明 |
|---|---|
| `RAG_SERVICE_URL` | Python 检索服务地址（默认 `http://127.0.0.1:8000`） |
| `RAG_TIMEOUT_MS` | 检索超时，默认 `15000`。hybrid 中位只要 ~60ms，余量是留给 rerank 模式和冷启动加载模型的 |
| `RAG_RETRIEVAL_MODE` | `dense` / `bm25` / `hybrid`（默认）。重排写成池深后缀，如 `hybrid+rerank20`；`bm25` 只用来做归因，线上不用 |
| `OLLAMA_BASE_URL` | Ollama 地址（默认 `http://127.0.0.1:11434`） |
| `OLLAMA_EMBED_MODEL` | embedding 模型名（默认 `bge-m3`） |
| `OLLAMA_KEEP_ALIVE` | 模型驻留时长（默认 `-1`，永不卸载）。设 `30m` 这类时长可省内存，代价是空闲后第一次问答要等冷加载 |

重排还有三个调优项（`RAG_RERANK_BATCH` / `RAG_RERANK_THREADS` / `RAG_RERANK_MAX_LENGTH`），默认值是在 CPU 上调过的，见 [`.env.example`](.env.example) 与 `rag-service/rerank.py`。

### 预算与限流

见 `src/lib/ai/usage.ts` 与 `src/lib/ai/rateLimit.ts`。

| 变量 | 说明 |
|---|---|
| `AI_DAILY_CALL_LIMIT` | 每用户每日模型调用次数。**`0` 表示不限制**（不是「全拦」） |
| `AI_DAILY_TOKEN_LIMIT` | 全站每日 token 和（prompt + completion）。`0` 表示不限制 |
| `AI_BUDGET_TZ_OFFSET_MIN` | 预算重置用的时区偏移（分钟），默认 `0`（UTC）。负数合法，`-720` = UTC-12 |
| `AI_RATE_LIMIT_PER_MIN` | 每用户限流，默认 `10` 次/分，`0` 表示不限制。桶存在**进程内存**里，多实例下每实例各算各的，实际额度是 N 倍 |

### 日志

| 变量 | 说明 |
|---|---|
| `LOG_LEVEL` | 默认 `info`，低于该级别的不写出。生产单行 JSON 到 stdout，开发自动换 pino-pretty。`scripts/*.ts` 里这行不生效 |

容器专用三项（`AUTH_TRUST_HOST` / `AUTH_URL` / `HOSTNAME`）由 `docker-compose.yml` 直接给，本地 `npm run dev` 不用设，理由见上面的 [Docker 一节](#docker)。

## 测试

```bash
npm test    # 运行 Vitest 单测
npm run lint
npm run build
```

`npm run build` 会额外产出 `.next/standalone`（`next.config.ts` 里的 `output: "standalone"`，给 Docker 用）。`npm run dev` / `npm start` 不受影响。

CI（`.github/workflows/ci.yml`）在 push 时跑 `npm ci` → `prisma generate` → `lint` → `tsc --noEmit` → `test`。

**检索评测（`eval:retrieval` / `eval:answer`）刻意不进 CI**：它要一个跑着的本地 Ollama（bge-m3）加 `rag-service/data/vectors.db`，而 `data/` 整个在 `.gitignore` 里（语料 + 向量库都不进仓库），runner 上既没有也无从重建。这两个脚本在本地跑，见上面的 RAG 一节。

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
.venv/Scripts/python -m pip install -r requirements.txt
.venv/Scripts/python ingest.py                  # 把 data/*.txt 切块入库到 data/vectors.db
.venv/Scripts/python server.py                  # 检索服务监听 127.0.0.1:8000
```

换 embedding 模型后必须重跑 `ingest.py` 重建索引，否则 `/search` 会返回维度不一致的提示。Ollama 或向量库不可用时，前端会降级为"未检索到相关文档片段"，不会报错中断。

## AI 接入

菜谱推荐、训练计划、RAG 问答共用一层 LLM 抽象（[src/lib/ai/llm.ts](src/lib/ai/llm.ts)），prompt 与厂商无关，切换后端不用改业务代码。

| 模式 | 触发条件 | 行为 |
|---|---|---|
| `deepseek` | 配了 `DEEPSEEK_API_KEY` | OpenAI 兼容接口 + JSON Schema 注入 prompt，zod 二次校验 |
| `claude` | 配了 `ANTHROPIC_API_KEY` | 官方 SDK `messages.parse`，结构由 API 侧保证 |
| `rule` | 两个 key 都没配 | 菜谱/计划回退本地规则库；RAG 问答直接报错（无规则库可降级） |

不设 `AI_PROVIDER` 时按已配置的 key **自动探测**（DeepSeek 优先）；显式指定但缺对应 key 会降级回 `rule`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | SQLite 文件路径（`file:./dev.db`） |
| `AUTH_SECRET` | Auth.js 会话密钥 |
| `AI_PROVIDER` | 可选，`deepseek` / `claude` / `rule`，留空则按 key 自动探测 |
| `DEEPSEEK_API_KEY` | DeepSeek key（配了即启用） |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | 默认 `deepseek-chat` |
| `ANTHROPIC_API_KEY` | Claude key（配了即可用 `AI_PROVIDER=claude`） |
| `RAG_SERVICE_URL` | Python 检索服务地址（默认 `http://127.0.0.1:8000`） |
| `OLLAMA_BASE_URL` | Ollama 地址（默认 `http://127.0.0.1:11434`） |
| `OLLAMA_EMBED_MODEL` | embedding 模型名（默认 `bge-m3`） |

## 测试

```bash
npm test    # 运行 Vitest 单测（32 个用例）
npm run lint
npm run build
```

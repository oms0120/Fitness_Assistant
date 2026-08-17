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
- `@anthropic-ai/sdk`（可选 AI 增强，`claude-opus-5`，未配 key 时回退规则库）
- Vitest

## 快速开始

```bash
npm install
cp .env.example .env        # 配置 DATABASE_URL + AUTH_SECRET
npx prisma migrate dev      # 初始化数据库
npm run dev                 # 启动开发服务器
```

打开 http://localhost:3000

## 环境变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | SQLite 文件路径（`file:./dev.db`） |
| `AUTH_SECRET` | Auth.js 会话密钥 |
| `AI_PROVIDER` | `rule`（默认）或 `claude`，控制 AI 增强开关 |
| `ANTHROPIC_API_KEY` | Claude API key（可选，配了且 `AI_PROVIDER=claude` 才启用） |

## 测试

```bash
npm test    # 运行 Vitest 单测（32 个用例）
npm run lint
npm run build
```

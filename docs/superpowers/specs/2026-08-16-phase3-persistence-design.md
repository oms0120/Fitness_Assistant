# 阶段 3 设计：后端持久化（账户 + 档案 + 历史）

> 日期：2026-08-16
> 状态：待审查

## Context

阶段 1（6 个计算器）、阶段 2（动作库/菜谱/训练计划）已完成。阶段 3 引入后端持久化：用户账户、身体档案、计算历史，实现登录后保存与查看。

## 已确认决策

- **数据库**：SQLite（零配置，Prisma 原生支持，后续可迁移 PostgreSQL）
- **认证**：Auth.js (NextAuth v5) + Credentials（邮箱 + 密码）
- **数据范围**：身体档案（Profile）+ 计算历史（Log）；训练计划云端同步后置

## 技术栈新增

- `prisma` + `@prisma/client`（ORM）
- `next-auth@beta`（Auth.js v5）+ `@auth/prisma-adapter`
- `bcryptjs`（密码哈希）

## 数据模型（Prisma schema，SQLite）

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  profiles     Profile[]
  logs         Log[]
  createdAt    DateTime  @default(now())
}

model Profile {
  id        String   @id @default(cuid())
  userId    String
  sex       String          // male | female
  heightCm  Float
  weightKg  Float
  neckCm    Float
  waistCm   Float
  hipCm     Float?
  age       Int
  goal      String          // cut | bulk | maintain
  activity  String          // sedentary | light | moderate | high | extreme
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Log {
  id        String   @id @default(cuid())
  userId    String
  type      String          // bmr | bodyfat | macros | ffmi | onerm
  data      String          // JSON 字符串（SQLite 无 Json 类型，序列化存储）
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

> 说明：Auth.js 的 Account/Session/VerificationToken 表在 Credentials + JWT session 模式下不需要。采用 **JWT session**（而非 database session），避免 Credentials provider 与 database session 的已知兼容问题。Prisma 仅存业务数据（User/Profile/Log）。

## 认证（Auth.js v5）

- Credentials provider：`authorize` 里用 Prisma 查 `User`，`bcrypt.compare` 校验密码
- JWT session strategy（`session: { strategy: "jwt" }`），`AUTH_SECRET` 环境变量
- 路由：`src/app/api/auth/[...nextauth]/route.ts`
- 登录/注册页：`src/app/(auth)/login/page.tsx`、`register/page.tsx`

## API（Route Handlers，需登录）

- `GET/POST /api/profile`：读/写当前用户身体档案（POST 每次新建一条，保留历史版本）
- `GET /api/logs`：读当前用户计算历史（按时间倒序）
- `POST /api/logs`：保存一条计算快照（`{ type, data }`，data 为输入+结果 JSON）
- 鉴权：用 Auth.js 的 `auth()` 获取 session，未登录返回 401

## 页面

- `/login`、`/register`：登录/注册
- `/profile`：身体档案表单（登录后填写/更新，复用阶段 1 的字段）
- `/history`：历史记录列表（按类型分组/倒序展示）
- 计算器页：登录后加「保存结果」按钮，POST 到 `/api/logs`
- 导航：登录状态显示用户邮箱 + 退出按钮；未登录显示「登录」

## 环境变量（`.env`）

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="<生成>"
```

## 约定

- 密码仅存 bcrypt 哈希，绝不存明文
- `Log.data` 存 JSON 字符串，读取时 `JSON.parse`
- SQLite 数据库文件 `prisma/dev.db` 加入 `.gitignore`

## 非目标（YAGNI）

- OAuth 登录（GitHub/Google）
- 训练计划云端同步（阶段 2 的 localStorage 保留）
- 邮箱验证、密码找回、账户管理后台
- 多端实时同步

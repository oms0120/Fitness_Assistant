# 阶段 3 实现计划：后端持久化（账户 + 档案 + 历史）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 引入 SQLite + Prisma + Auth.js v5 账户体系，实现登录/注册、身体档案读写、计算历史保存与查看。

**架构：** Prisma（SQLite）+ Auth.js v5（Credentials + JWT session）+ Route Handlers API + 页面。延续阶段 1/2 的模式。

**技术栈：** Next.js 16、Prisma、Auth.js v5（next-auth@beta）、bcryptjs、zod。

**规格来源：** `docs/superpowers/specs/2026-08-16-phase3-persistence-design.md`

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `prisma/schema.prisma` | User/Profile/Log 数据模型 |
| `src/lib/db/prisma.ts` | Prisma 单例 |
| `src/auth.ts` | Auth.js 配置（Credentials + JWT） |
| `src/app/api/auth/[...nextauth]/route.ts` | Auth.js handlers |
| `src/app/api/register/route.ts` | 注册 API |
| `src/app/api/profile/route.ts` | 档案 GET/POST |
| `src/app/api/logs/route.ts` | 历史 GET/POST |
| `src/app/(auth)/login/page.tsx`、`register/page.tsx` | 登录/注册页 |
| `src/app/profile/page.tsx` | 身体档案页 |
| `src/app/history/page.tsx` | 历史记录页 |
| `src/components/auth/*.tsx` | 认证相关组件 |
| `.env` | DATABASE_URL、AUTH_SECRET |

---

## 任务 1：Prisma 环境 + schema + 迁移

**文件：**
- 创建：`prisma/schema.prisma`
- 创建：`src/lib/db/prisma.ts`
- 修改：`.env`、`.gitignore`

- [ ] **步骤 1：安装依赖**

```bash
npm install @prisma/client bcryptjs next-auth@beta
npm install -D prisma
```

- [ ] **步骤 2：创建 prisma/schema.prisma**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

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
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Log {
  id        String   @id @default(cuid())
  userId    String
  type      String
  data      String
  createdAt DateTime @default(now())
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

- [ ] **步骤 3：配置 .env**

在 `.env` 末尾追加（`.env` 已被 gitignore）：

```
DATABASE_URL="file:./dev.db"
AUTH_SECRET="dev-secret-change-in-prod-please"
```

- [ ] **步骤 4：生成 Prisma client + 迁移**

```bash
npx prisma migrate dev --name init
```

预期：生成 `prisma/dev.db` 和 `prisma/migrations/` 目录。

- [ ] **步骤 5：在 .gitignore 追加 SQLite 数据库**

在 `.gitignore` 追加：

```
# sqlite
prisma/*.db
prisma/*.db-journal
```

- [ ] **步骤 6：创建 src/lib/db/prisma.ts**

```ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

- [ ] **步骤 7：验证**

运行：`npx prisma migrate status`
预期：显示 init 迁移已应用

- [ ] **步骤 8：Commit**

```bash
git add prisma/ src/lib/db/prisma.ts .gitignore package.json package-lock.json
git commit -m "chore: add prisma with sqlite schema"
```

---

## 任务 2：注册 API

**文件：**
- 创建：`src/app/api/register/route.ts`

- [ ] **步骤 1：创建 register route**

```ts
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";

const registerSchema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(6, "密码至少 6 位").max(72, "密码过长"),
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }
  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    const errors = Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]));
    return NextResponse.json({ errors }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({ data: { email, passwordHash } });
  return NextResponse.json({ ok: true });
}
```

- [ ] **步骤 2：验证**

运行：`npm run build`
预期：build 成功

- [ ] **步骤 3：Commit**

```bash
git add src/app/api/register/
git commit -m "feat: add register api"
```

---

## 任务 3：Auth.js 配置 + 登录

**文件：**
- 创建：`src/auth.ts`
- 创建：`src/app/api/auth/[...nextauth]/route.ts`

- [ ] **步骤 1：创建 src/auth.ts**

```ts
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "邮箱" },
        password: { label: "密码" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;
        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;
        return { id: user.id, email: user.email };
      },
    }),
  ],
});
```

- [ ] **步骤 2：创建 src/app/api/auth/[...nextauth]/route.ts**

```ts
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **步骤 3：验证**

运行：`npm run build`
预期：build 成功

- [ ] **步骤 4：Commit**

```bash
git add src/auth.ts src/app/api/auth/
git commit -m "feat: add auth.js credentials login"
```

---

## 任务 4：登录/注册页面

**文件：**
- 创建：`src/app/(auth)/login/page.tsx`
- 创建：`src/app/(auth)/register/page.tsx`

- [ ] **步骤 1：创建登录页**

`src/app/(auth)/login/page.tsx`：

```tsx
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    if (res?.error) {
      setError("邮箱或密码错误");
      return;
    }
    router.push("/profile");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">登录</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">邮箱</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">密码</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">登录</button>
      </form>
      <p className="mt-4 text-sm text-zinc-500">没有账户？<Link href="/register" className="underline">注册</Link></p>
    </div>
  );
}
```

- [ ] **步骤 2：创建注册页**

`src/app/(auth)/register/page.tsx`：

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "注册失败");
      return;
    }
    router.push("/login");
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="mb-6 text-2xl font-semibold">注册</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">邮箱</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">密码（至少 6 位）</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">注册</button>
      </form>
      <p className="mt-4 text-sm text-zinc-500">已有账户？<Link href="/login" className="underline">登录</Link></p>
    </div>
  );
}
```

- [ ] **步骤 3：验证**

运行：`npm run lint && npm run build`
预期：lint 无错误，build 成功

- [ ] **步骤 4：Commit**

```bash
git add "src/app/(auth)/"
git commit -m "feat: add login and register pages"
```

---

## 任务 5：身体档案 API + 页面

**文件：**
- 创建：`src/app/api/profile/route.ts`
- 创建：`src/app/profile/page.tsx`

- [ ] **步骤 1：创建 profile route**

```ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

const profileSchema = z.object({
  sex: z.enum(["male", "female"]),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(300),
  neckCm: z.number().min(20).max(120),
  waistCm: z.number().min(20).max(120),
  hipCm: z.number().min(20).max(120).optional(),
  age: z.number().int().min(10).max(100),
  goal: z.enum(["cut", "bulk", "maintain"]),
  activity: z.enum(["sedentary", "light", "moderate", "high", "extreme"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const profiles = await prisma.profile.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ profiles });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const profile = await prisma.profile.create({
    data: { userId: session.user.id as string, ...parsed.data },
  });
  return NextResponse.json({ profile });
}
```

- [ ] **步骤 2：创建 profile 页（表单，含结果预览）**

`src/app/profile/page.tsx`（服务端壳）：

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ProfileClient } from "./profile-client";

export default async function ProfilePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return <ProfileClient />;
}
```

`src/app/profile/profile-client.tsx`（客户端表单，复用 calculateBmr/calculateTdee 显示 BMR 预览）：

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { calculateBmr, calculateTdee, ActivityLevel, ACTIVITY_LEVEL_LABELS } from "@/lib/calculators";
import { NumberField } from "@/components/calculators/NumberField";

export function ProfileClient() {
  const router = useRouter();
  const [sex, setSex] = useState("male");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [neckCm, setNeckCm] = useState("");
  const [waistCm, setWaistCm] = useState("");
  const [hipCm, setHipCm] = useState("");
  const [age, setAge] = useState("");
  const [goal, setGoal] = useState("cut");
  const [activity, setActivity] = useState<ActivityLevel>(ActivityLevel.MODERATE);
  const [msg, setMsg] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  function onBmrPreview() {
    const r = calculateBmr({ sex, weightKg: Number(weightKg), heightCm: Number(heightCm), age: Number(age) });
    if (r.ok) {
      const t = calculateTdee({ bmr: r.data.bmr, activityLevel: activity });
      setPreview(`BMR ${r.data.bmr.toFixed(0)} kcal · TDEE ${t.ok ? t.data.tdee.toFixed(0) : "-"} kcal`);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sex, heightCm: Number(heightCm), weightKg: Number(weightKg),
        neckCm: Number(neckCm), waistCm: Number(waistCm),
        hipCm: sex === "female" ? Number(hipCm) : undefined,
        age: Number(age), goal, activity,
      }),
    });
    const data = await res.json();
    if (!res.ok) { setMsg(data.error ?? "保存失败"); return; }
    setMsg("已保存");
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold">身体档案</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" checked={sex === "male"} onChange={() => setSex("male")} /> 男</label>
          <label className="flex items-center gap-2"><input type="radio" checked={sex === "female"} onChange={() => setSex("female")} /> 女</label>
        </div>
        <NumberField label="身高" unit="cm" value={heightCm} onChange={setHeightCm} />
        <NumberField label="体重" unit="kg" value={weightKg} onChange={setWeightKg} />
        <NumberField label="颈围" unit="cm" value={neckCm} onChange={setNeckCm} />
        <NumberField label="腰围" unit="cm" value={waistCm} onChange={setWaistCm} />
        {sex === "female" && <NumberField label="臀围" unit="cm" value={hipCm} onChange={setHipCm} />}
        <NumberField label="年龄" unit="岁" value={age} onChange={setAge} step="1" />
        <label className="block">
          <span className="mb-1 block text-sm font-medium">目标</span>
          <select value={goal} onChange={(e) => setGoal(e.target.value)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            <option value="cut">减脂</option>
            <option value="bulk">增肌</option>
            <option value="maintain">维持</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">活动水平</span>
          <select value={activity} onChange={(e) => setActivity(e.target.value as ActivityLevel)} className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            {Object.entries(ACTIVITY_LEVEL_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        </label>
        {preview && <p className="text-sm text-zinc-500">{preview}</p>}
        {msg && <p className="text-sm text-zinc-500">{msg}</p>}
        <button type="submit" className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white dark:bg-white dark:text-black">保存档案</button>
      </form>
    </div>
  );
}
```

- [ ] **步骤 3：验证**

运行：`npm run lint && npm run build`
预期：lint 无错误，build 成功

- [ ] **步骤 4：Commit**

```bash
git add src/app/api/profile/ src/app/profile/
git commit -m "feat: add profile api and page"
```

---

## 任务 6：历史记录 API + 页面

**文件：**
- 创建：`src/app/api/logs/route.ts`
- 创建：`src/app/history/page.tsx`

- [ ] **步骤 1：创建 logs route**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const logs = await prisma.log.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ logs });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const type = String(body?.type ?? "");
  if (!["bmr", "bodyfat", "macros", "ffmi", "onerm"].includes(type)) {
    return NextResponse.json({ error: "类型无效" }, { status: 400 });
  }
  const log = await prisma.log.create({
    data: {
      userId: session.user.id as string,
      type,
      data: JSON.stringify(body?.data ?? {}),
    },
  });
  return NextResponse.json({ log });
}
```

- [ ] **步骤 2：创建 history 页**

`src/app/history/page.tsx`（服务端读取 + 渲染）：

```tsx
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

const TYPE_LABELS: Record<string, string> = {
  bmr: "BMR/TDEE",
  bodyfat: "体脂率",
  macros: "宏量营养",
  ffmi: "FFMI",
  onerm: "1RM",
};

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const logs = await prisma.log.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-semibold">历史记录</h1>
      {logs.length === 0 ? (
        <p className="text-zinc-500">暂无记录。去计算器计算并「保存结果」吧。</p>
      ) : (
        <div className="space-y-3">
          {logs.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div>
                <div className="font-medium">{TYPE_LABELS[l.type] ?? l.type}</div>
                <div className="mt-1 font-mono text-xs text-zinc-500">{l.data}</div>
              </div>
              <div className="text-xs text-zinc-500">{new Date(l.createdAt).toLocaleString("zh-CN")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **步骤 3：验证**

运行：`npm run lint && npm run build`
预期：lint 无错误，build 成功

- [ ] **步骤 4：Commit**

```bash
git add src/app/api/logs/ src/app/history/
git commit -m "feat: add logs api and history page"
```

---

## 任务 7：计算器「保存结果」+ 导航登录状态 + 集成验证

**文件：**
- 修改：`src/app/layout.tsx`（导航加登录状态）
- 修改：`src/app/calculators/bmr/page.tsx`（加保存按钮，作为其他计算器的示范）

- [ ] **步骤 1：layout.tsx 加导航（登录状态 + 入口）**

修改 `src/app/layout.tsx` 的 body 内，在 children 前加一个顶部导航：

```tsx
import { auth } from "@/auth";
import Link from "next/link";

async function Nav() {
  const session = await auth();
  return (
    <nav className="border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <Link href="/" className="font-semibold">智能健身助手</Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/calculators" className="text-zinc-600 dark:text-zinc-400">计算器</Link>
          <Link href="/exercises" className="text-zinc-600 dark:text-zinc-400">动作库</Link>
          <Link href="/plans" className="text-zinc-600 dark:text-zinc-400">训练计划</Link>
          <Link href="/meals" className="text-zinc-600 dark:text-zinc-400">菜谱</Link>
          {session?.user ? (
            <>
              <Link href="/profile" className="text-zinc-600 dark:text-zinc-400">档案</Link>
              <Link href="/history" className="text-zinc-600 dark:text-zinc-400">历史</Link>
              <span className="text-zinc-500">{session.user.email}</span>
            </>
          ) : (
            <Link href="/login" className="text-zinc-600 dark:text-zinc-400">登录</Link>
          )}
        </div>
      </div>
    </nav>
  );
}
```

> 注意：`layout.tsx` 是服务端组件，`auth()` 可在此调用。将 Nav 作为 layout 内的一个 async 服务端组件使用。具体结构：保持原有 `RootLayout`，在 `{children}` 前插入 `<Nav />`，并把 `import { auth } from "@/auth"` 与 `Link` 加入。实现时需读现有 layout.tsx 结构后按此意图插入。

- [ ] **步骤 2：bmr 页加「保存结果」按钮**

在 `src/app/calculators/bmr/page.tsx` 的 `onSubmit` 里，计算成功后额外调用保存（仅当登录时；未登录静默跳过或提示）：

```tsx
// 在 onSubmit 计算成功后追加：
async function saveResult(bmr: number, tdee: number) {
  const res = await fetch("/api/logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "bmr", data: { bmr, tdee, sex, weightKg, heightCm, age, activity } }),
  });
  if (res.status === 401) return; // 未登录静默跳过
}
```

在 `onSubmit` 内，`setResult(...)` 后调用 `saveResult(bmrRes.data.bmr, tdeeRes.data.tdee)`。

- [ ] **步骤 3：全量验证**

```bash
npm test && npm run lint && npm run build
```

预期：测试全绿、lint 无错误、build 成功（含 /login、/register、/profile、/history 路由）

- [ ] **步骤 4：手动冒烟**

`npm run dev` 后：注册 → 登录 → 填档案保存 → 计算器算一次 → 保存结果 → 历史页看到记录。

- [ ] **步骤 5：Commit 并推送**

```bash
git add src/app/layout.tsx src/app/calculators/bmr/page.tsx
git commit -m "feat: add save result and nav auth state"
git push
```

---

## 自检记录

- **规格覆盖度**：Prisma schema + 迁移（任务 1）、注册（任务 2）、Auth.js 登录（任务 3）、登录/注册页（任务 4）、档案 API+页（任务 5）、历史 API+页（任务 6）、保存按钮 + 导航（任务 7）均覆盖。
- **占位符**：任务 7 的 layout.tsx 改造标注为「读现有结构后插入」，需实现者谨慎处理（现有 layout 有 shadcn 的字体/全局样式）。
- **类型一致性**：`session.user.id` 来自 Auth.js JWT，需 `as string` 断言（JWT 里 id 可能是 string）；`ACTIVITY_LEVEL_LABELS` 在阶段 2 已加到 `calculators/types.ts`，profile 页直接复用。
- **测试策略**：阶段 3 以集成验证为主（Auth.js + Prisma 单测环境成本高），公式正确性已在阶段 1 锁定。

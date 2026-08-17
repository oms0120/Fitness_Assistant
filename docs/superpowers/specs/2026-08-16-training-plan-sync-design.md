# 训练计划云端同步 设计

> 日期：2026-08-16
> 状态：已确认

## Context

阶段 2 的训练计划用 localStorage 本地保存。本迭代升级为数据库存储，登录后多端同步，复用阶段 3 的账户体系（SQLite + Prisma + Auth.js）。

## 已确认决策

- **未登录行为**：显示预设模板（只读），点编辑提示登录；登录后云端读写
- **数据粒度**：每用户一条完整计划，`data` 存 `PlanDay[]` 的 JSON 字符串（简单，无需结构化拆分）
- **localStorage**：移除，旧本地数据不迁移（YAGNI）

## 数据模型（Prisma 新增）

```prisma
model TrainingPlan {
  id        String   @id @default(cuid())
  userId    String   @unique
  data      String              // JSON 字符串，存完整 PlanDay[]
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

## API（Route Handlers，需登录）

- `GET /api/training-plan`：读当前用户计划，无则 `{ plan: null }`，有则 `{ plan: <PlanDay[]> }`（data 解析后返回）
- `PUT /api/training-plan`：upsert，`{ data: <PlanDay[]> }` 序列化存 `data` 字段

## 页面改造（`src/app/plans/`）

- 服务端壳：`auth()` 判登录态，传入客户端组件
- 客户端（plans-client.tsx）：
  - 未登录：渲染预设模板（只读），顶部提示「登录后可编辑并同步」
  - 登录后：`useEffect` GET 加载（有则云端、无则预设模板），调整后 `PUT` 保存
  - 编辑 UI（改组数/次数、增删动作、重置）复用阶段 2 逻辑，存储层从 localStorage 换成 API
  - 「重置」恢复预设模板并保存云端

## 复用

- `planTemplates`、`exercises`（阶段 2 数据）
- Auth.js `auth()`（阶段 3）
- Prisma 单例 `src/lib/db/prisma.ts`

## 非目标（YAGNI）

- localStorage 旧数据迁移
- 训练计划版本历史
- 计划分享/导出

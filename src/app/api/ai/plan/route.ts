import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvider } from "@/lib/ai/provider";
import { RateLimitedError, enforceRateLimit, retryAfterSeconds } from "@/lib/ai/rateLimit";
import type { PlanRequest } from "@/lib/ai/types";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流排在解析 body **之前**，且必须是独立的 try —— 理由见 recipes 路由的同名注释
  try {
    await enforceRateLimit(session.user.id);
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", reason: "rate_limit" },
        { status: 429, headers: { "Retry-After": String(retryAfterSeconds(e)) } },
      );
    }
    throw e;
  }

  // 畸形 body 是 400 不是 500：`req.json()` 抛的是 SyntaxError，那是客户端的问题。
  // 这里只拦"连 JSON 都不是"；结构和原来一样不做校验，原样透传给 provider。
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const provider = getProvider(session.user.id);
  try {
    const plan = await provider.generatePlan(body as PlanRequest);
    // degraded 的含义见 recipes 路由的同名注释
    return NextResponse.json({ plan, degraded: provider.degraded ?? false });
  } catch (e) {
    console.error("[ai/plan]", e);
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}

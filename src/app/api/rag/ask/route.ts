import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { askWithRag } from "@/lib/rag/ragService";
import { BudgetExceededError } from "@/lib/ai/usage";
import { RateLimitedError, enforceRateLimit, retryAfterSeconds } from "@/lib/ai/rateLimit";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流排在解析 body **之前**，且必须是独立的 try —— 理由见 ai/recipes 路由的同名注释
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体无效" }, { status: 400 });
  }

  const question = (body as { question?: unknown })?.question;
  if (!question || typeof question !== "string" || !question.trim()) {
    return NextResponse.json({ error: "问题不能为空" }, { status: 400 });
  }

  try {
    const result = await askWithRag(question.trim(), session.user.id);
    // 只回 answer/sources：result.chunks 是内部评测要用的召回全文，不进 API 响应
    return NextResponse.json({ answer: result.answer, sources: result.sources });
  } catch (e) {
    // 必须排在通用 500 前面，否则额度用尽又塌成一句"生成失败"，
    // 客户端分不出「该等明天」和「该重试」。
    //
    // `reason` 是**写死**的，不能写成 `e.reason` —— BudgetExceededError 自己的
    // reason 是 "calls" | "tokens"，那样会漏出第三个取值，客户端就分不出两种 429。
    if (e instanceof BudgetExceededError) {
      return NextResponse.json(
        { error: "今日 AI 额度已用完，请明天再试", reason: "budget" },
        { status: 429 },
      );
    }
    console.error("[rag/ask]", e);
    return NextResponse.json({ error: "AI 回答生成失败，请稍后重试" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvider } from "@/lib/ai/provider";
import { RateLimitedError, enforceRateLimit, retryAfterSeconds } from "@/lib/ai/rateLimit";
import type { RecipeRequest } from "@/lib/ai/types";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  // 限流排在解析 body **之前**：最便宜的检查最先做，而且对着一堆畸形 body 猛刷
  // 的用户也该被挡（那同样是白烧 CPU）。
  //
  // 必须是独立的 try —— 要是让 RateLimitedError 漏进下面那个 catch，返回值就成了
  // 一句"AI 生成失败"的 500，而限流的意义正是让客户端认出 429 该等一会儿。
  try {
    await enforceRateLimit(session.user.id);
  } catch (e) {
    if (e instanceof RateLimitedError) {
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试", reason: "rate_limit" },
        // Retry-After 是标准头，单位**秒**。这是全仓库第一个自定义响应头。
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
    const suggestions = await provider.recommendRecipes(body as RecipeRequest);
    // degraded：额度用尽时这里是规则库的结果。不带这个字段的话降级是静默的，
    // 用户会以为模型就这水平。前端暂未消费，先把契约立起来。
    return NextResponse.json({ suggestions, degraded: provider.degraded ?? false });
  } catch (e) {
    console.error("[ai/recipes]", e);
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}

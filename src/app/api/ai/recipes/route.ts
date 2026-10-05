import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProvider } from "@/lib/ai/provider";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const provider = getProvider(session.user.id);
  try {
    const suggestions = await provider.recommendRecipes(body);
    // degraded：额度用尽时这里是规则库的结果。不带这个字段的话降级是静默的，
    // 用户会以为模型就这水平。前端暂未消费，先把契约立起来。
    return NextResponse.json({ suggestions, degraded: provider.degraded ?? false });
  } catch (e) {
    console.error("[ai/recipes]", e);
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}

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
    const plan = await provider.generatePlan(body);
    // degraded 的含义见 recipes 路由的同名注释
    return NextResponse.json({ plan, degraded: provider.degraded ?? false });
  } catch (e) {
    console.error("[ai/plan]", e);
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}

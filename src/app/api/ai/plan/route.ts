import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";

export async function POST(req: Request) {
  const body = await req.json();
  const provider = getProvider();
  try {
    const plan = await provider.generatePlan(body);
    return NextResponse.json({ plan });
  } catch {
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getProvider } from "@/lib/ai/provider";

export async function POST(req: Request) {
  const body = await req.json();
  const provider = getProvider();
  try {
    const suggestions = await provider.recommendRecipes(body);
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json({ error: "AI 生成失败，请稍后重试" }, { status: 500 });
  }
}

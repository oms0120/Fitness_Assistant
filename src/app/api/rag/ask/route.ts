import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { askWithRag } from "@/lib/rag/ragService";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
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
    const result = await askWithRag(question.trim());
    return NextResponse.json(result);
  } catch (e) {
    console.error("[rag/ask]", e);
    return NextResponse.json({ error: "AI 回答生成失败，请稍后重试" }, { status: 500 });
  }
}

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
    // 只回 answer/sources：result.chunks 是内部评测要用的召回全文，不进 API 响应
    return NextResponse.json({ answer: result.answer, sources: result.sources });
  } catch (e) {
    console.error("[rag/ask]", e);
    return NextResponse.json({ error: "AI 回答生成失败，请稍后重试" }, { status: 500 });
  }
}

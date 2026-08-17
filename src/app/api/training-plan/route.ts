import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const record = await prisma.trainingPlan.findUnique({
    where: { userId: session.user.id },
  });
  if (!record) return NextResponse.json({ plan: null });
  return NextResponse.json({ plan: JSON.parse(record.data) });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const data = body?.data;
  if (!Array.isArray(data)) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const record = await prisma.trainingPlan.upsert({
    where: { userId: session.user.id },
    update: { data: JSON.stringify(data) },
    create: { userId: session.user.id, data: JSON.stringify(data) },
  });
  return NextResponse.json({ ok: true, updatedAt: record.updatedAt });
}

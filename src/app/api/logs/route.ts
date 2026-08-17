import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const logs = await prisma.log.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ logs });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const type = String(body?.type ?? "");
  if (!["bmr", "bodyfat", "macros", "ffmi", "onerm"].includes(type)) {
    return NextResponse.json({ error: "类型无效" }, { status: 400 });
  }
  const log = await prisma.log.create({
    data: {
      userId: session.user.id as string,
      type,
      data: JSON.stringify(body?.data ?? {}),
    },
  });
  return NextResponse.json({ log });
}

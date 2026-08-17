import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

const profileSchema = z.object({
  sex: z.enum(["male", "female"]),
  heightCm: z.number().min(100).max(250),
  weightKg: z.number().min(30).max(300),
  neckCm: z.number().min(20).max(120),
  waistCm: z.number().min(20).max(120),
  hipCm: z.number().min(20).max(120).optional(),
  age: z.number().int().min(10).max(100),
  goal: z.enum(["cut", "bulk", "maintain"]),
  activity: z.enum(["sedentary", "light", "moderate", "high", "extreme"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const profiles = await prisma.profile.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ profiles });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const body = await req.json();
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "参数无效" }, { status: 400 });
  }
  const profile = await prisma.profile.create({
    data: { userId: session.user.id, ...parsed.data },
  });
  return NextResponse.json({ profile });
}

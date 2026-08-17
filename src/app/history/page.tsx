import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/prisma";

const TYPE_LABELS: Record<string, string> = {
  bmr: "BMR/TDEE",
  bodyfat: "体脂率",
  macros: "宏量营养",
  ffmi: "FFMI",
  onerm: "1RM",
};

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const logs = await prisma.log.findMany({
    where: { userId: session.user.id as string },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-semibold">历史记录</h1>
      {logs.length === 0 ? (
        <p className="text-zinc-500">暂无记录。去计算器计算并「保存结果」吧。</p>
      ) : (
        <div className="space-y-3">
          {logs.map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <div>
                <div className="font-medium">{TYPE_LABELS[l.type] ?? l.type}</div>
                <div className="mt-1 font-mono text-xs text-zinc-500">{l.data}</div>
              </div>
              <div className="text-xs text-zinc-500">{new Date(l.createdAt).toLocaleString("zh-CN")}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

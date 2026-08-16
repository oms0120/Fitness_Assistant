import Link from "next/link";

const items = [
  { href: "/calculators", name: "计算器", desc: "代谢 / 体脂 / 宏量 / FFMI / 1RM" },
  { href: "/exercises", name: "动作库", desc: "胸、肩、背、腿、臂动作" },
  { href: "/plans", name: "训练计划", desc: "分部位训练模板，可自行调整" },
  { href: "/meals", name: "菜谱库", desc: "减脂 / 增肌 / 均衡，支持按热量匹配" },
];

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-semibold">智能健身助手</h1>
      <p className="mt-3 text-zinc-500">身体代谢 · 体脂 · 营养 · 训练</p>
      <div className="mt-10 grid w-full max-w-2xl gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="rounded-xl border border-zinc-200 p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600">
            <div className="text-lg font-medium">{it.name}</div>
            <div className="mt-1 text-sm text-zinc-500">{it.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <h1 className="text-3xl font-semibold">智能健身助手</h1>
      <p className="mt-3 text-zinc-500">身体代谢 · 体脂 · 营养 · 训练计算</p>
      <Link
        href="/calculators"
        className="mt-8 rounded-lg bg-zinc-900 px-6 py-3 text-white dark:bg-white dark:text-black"
      >
        进入计算器
      </Link>
    </div>
  );
}

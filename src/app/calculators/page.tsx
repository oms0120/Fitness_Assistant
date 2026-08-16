import Link from "next/link";

const items = [
  { href: "/calculators/bmr", name: "BMR / TDEE", desc: "基础代谢与每日总代谢" },
  { href: "/calculators/body-fat", name: "体脂率", desc: "美国海军体脂测量法" },
  { href: "/calculators/macros", name: "宏量营养", desc: "减脂/增肌/维持每日摄入" },
  { href: "/calculators/ffmi", name: "FFMI", desc: "去脂体重指数" },
  { href: "/calculators/one-rm", name: "1RM", desc: "最大重量估算" },
];

export default function CalculatorsPage() {
  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="mb-8 text-3xl font-semibold">健身计算器</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="rounded-xl border border-zinc-200 p-6 transition hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
          >
            <div className="text-lg font-medium">{it.name}</div>
            <div className="mt-1 text-sm text-zinc-500">{it.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

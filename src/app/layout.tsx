import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { auth, signOut } from "@/auth";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "智能健身助手",
  description: "身体代谢 · 体脂 · 营养 · 训练",
};

async function Nav() {
  const session = await auth();
  return (
    <nav className="border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <Link href="/" className="font-semibold">智能健身助手</Link>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/calculators" className="text-zinc-600 dark:text-zinc-400">计算器</Link>
          <Link href="/exercises" className="text-zinc-600 dark:text-zinc-400">动作库</Link>
          <Link href="/plans" className="text-zinc-600 dark:text-zinc-400">训练计划</Link>
          <Link href="/meals" className="text-zinc-600 dark:text-zinc-400">菜谱</Link>
          {session?.user ? (
            <>
              <Link href="/profile" className="text-zinc-600 dark:text-zinc-400">档案</Link>
              <Link href="/history" className="text-zinc-600 dark:text-zinc-400">历史</Link>
              <Link href="/ask" className="text-zinc-600 dark:text-zinc-400">AI 问答</Link>
              <span className="text-zinc-500">{session.user?.email ?? ""}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button type="submit" className="text-zinc-600 dark:text-zinc-400">退出</button>
              </form>
            </>
          ) : (
            <Link href="/login" className="text-zinc-600 dark:text-zinc-400">登录</Link>
          )}
        </div>
      </div>
    </nav>
  );
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Nav />
        {children}
      </body>
    </html>
  );
}

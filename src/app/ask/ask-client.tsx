"use client";

import { useState } from "react";

export function AskClient() {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true);
    setError("");
    setAnswer("");
    setSources([]);
    try {
      const res = await fetch("/api/rag/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "回答生成失败");
        return;
      }
      setAnswer(data.answer);
      setSources(data.sources ?? []);
    } catch {
      setError("网络错误，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="mb-6 text-3xl font-semibold">AI 健身问答</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="问点什么，例如：深蹲伤膝盖吗？减脂期晚餐吃什么？"
          rows={3}
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-zinc-900 px-4 py-2 text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          {loading ? "思考中…" : "提问"}
        </button>
      </form>
      {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
      {answer && (
        <div className="mt-6 rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
          <div className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{answer}</div>
          {sources.length > 0 && (
            <div className="mt-4 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
              <div className="mb-1 font-medium">参考来源：</div>
              {[...new Set(sources)].map((s) => (
                <div key={s}>{s}</div>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="mt-6 text-xs text-zinc-400">* AI 生成，基于文档内容，仅供参考，不构成医疗建议。</p>
    </div>
  );
}

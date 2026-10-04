/** 调 Python RAG 服务（FastAPI）做检索。服务不可用时返回空数组，上层降级。 */

const DEFAULT_RAG_URL = "http://127.0.0.1:8000";

/**
 * RAG 服务地址。做成函数而非常量：常量会在模块求值时就读 env，而脚本
 * （`scripts/eval-answer.ts`）是先用 `process.loadEnvFile()` 再跑，读早了会丢掉
 * `.env` 里的 `RAG_SERVICE_URL`。
 *
 * 导出给评测脚本做健康探针用：探针要能区分「服务没起」和「检索不到」，
 * 而 `searchChunks` 把这两种情况都吞成了空数组。
 */
export function ragUrl(): string {
  return process.env.RAG_SERVICE_URL ?? DEFAULT_RAG_URL;
}

export interface RagChunk {
  id: number;
  text: string;
  source: string;
  meta: string;
  score: number;
}

export async function searchChunks(query: string, topK = 5): Promise<RagChunk[]> {
  try {
    const res = await fetch(`${ragUrl()}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch {
    return [];
  }
}

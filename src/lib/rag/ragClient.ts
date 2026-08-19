/** 调 Python RAG 服务（FastAPI）做检索。服务不可用时返回空数组，上层降级。 */

const RAG_URL = process.env.RAG_SERVICE_URL ?? "http://127.0.0.1:8000";

export interface RagChunk {
  id: number;
  text: string;
  source: string;
  meta: string;
  score: number;
}

export async function searchChunks(query: string, topK = 5): Promise<RagChunk[]> {
  try {
    const res = await fetch(`${RAG_URL}/search`, {
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

/** 调 Python RAG 服务（FastAPI）做检索。服务不可用时返回空数组，上层降级。 */

import { readInt } from "@/lib/ai/resilience";

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

/**
 * 检索的超时上限。默认 hybrid 模式中位 ~60 ms，给 15 s 是留了重排模式
 * （`RAG_RETRIEVAL_MODE=hybrid+rerank20`，中位 ~4.9 s）和冷启动加载模型的余量。
 * 池深如果再往上加，这个数要跟着调。
 */
function timeoutMs(): number {
  return readInt(process.env.RAG_TIMEOUT_MS, 15_000, 1);
}

export interface RagChunk {
  id: number;
  text: string;
  source: string;
  meta: string;
  score: number;
}

/**
 * 这里不用 `withRetry`：RAG 是本地服务，超时/连不上基本都是"服务没起"，
 * 重试只会让页面多等几秒再降级。加超时是为了封顶，不是为了重试。
 */
export async function searchChunks(query: string, topK = 5): Promise<RagChunk[]> {
  try {
    const res = await fetch(`${ragUrl()}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, top_k: topK }),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.results ?? [];
  } catch {
    // 服务没起、超时、返回体不是 JSON —— 一律降级成"没检索到"
    return [];
  }
}

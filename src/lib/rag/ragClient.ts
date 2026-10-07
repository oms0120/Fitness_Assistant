/** 调 Python RAG 服务（FastAPI）做检索。服务不可用时返回空数组，上层降级。 */

import { readInt } from "@/lib/ai/resilience";
import { logger } from "@/lib/logger";

const DEFAULT_RAG_URL = "http://127.0.0.1:8000";

/**
 * RAG 服务地址。做成函数而非常量：常量会在模块求值时就读 env，而脚本
 * （`scripts/eval-answer.ts`）是先用 `process.loadEnvFile()` 再跑，读早了会丢掉
 * `.env` 里的 `RAG_SERVICE_URL`。
 *
 * 导出给评测脚本做健康探针用：探针是**主动**去问"服务还活着吗"，
 * 而 `searchChunks` 是**事后**归因（失败只留一条 warn 然后降级）。两者都要，
 * 探针能提前发现，日志能解释线上为什么答得差。
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
 *
 * `requestId` 会作为 `x-request-id` 发给 Python 服务，两边的日志就能对上同一个号。
 * 传 `undefined` 时**不发这个头**（而不是发个空串）—— 空串在 Python 侧是"有个头但没值"，
 * 和"没有这个头"是两种状态，没必要制造这个歧义。
 */
export async function searchChunks(
  query: string,
  topK = 5,
  requestId?: string,
): Promise<RagChunk[]> {
  try {
    const res = await fetch(`${ragUrl()}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(requestId ? { "x-request-id": requestId } : {}),
      },
      body: JSON.stringify({ query, top_k: topK }),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    if (!res.ok) {
      // 全仓唯一一处「检索失败」的可观测信号。不记的话线上分不清
      // 「RAG 服务挂了」和「真的没有匹配片段」—— 两者都表现为空数组、答案都没有出处。
      logger.warn({ requestId, status: res.status }, "[rag] 检索服务返回非 2xx，降级为无上下文");
      return [];
    }
    const data = await res.json();
    return data.results ?? [];
  } catch (err) {
    // 服务没起、超时、返回体不是 JSON —— 一律降级成"没检索到"，但要留下痕迹。
    // err 也要进日志：连不上和超时是两种故障，处理方式不同（起服务 vs 调 RAG_TIMEOUT_MS）。
    logger.warn({ err, requestId }, "[rag] 检索失败，降级为无上下文");
    return [];
  }
}

import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { requestIdFrom } from "@/lib/requestId";

/**
 * route handler 的统一入口包装：取号 → 处理 → 回显响应头 → 兜底。
 *
 * 抽成函数而不是每个路由抄一遍：三个路由加起来有 18 个 `return`
 * （401 / 429 / 400 / 500 / 200），逐个手动设头必漏一个，而**漏一个的后果是静默的** ——
 * 客户端拿不到号，那条链路就无从查起。收在这里之后，「入口生成 request ID」
 * 是结构性的，不靠自觉。
 *
 * 为什么 catch 也在这个包装里：`handle` 抛出去会冒到 Next 的默认错误处理，那条路径
 * 既没有日志也没有响应头 —— 恰好破坏了这个包装存在的理由。会走到这的是
 * `auth()` 自己抛错、以及限流块里非 `RateLimitedError` 的重抛。
 * **业务错误不该走这里**，各路由自己那段 try/catch 负责转成语义化的状态码
 * （429 额度、429 限流、400 畸形 body），它们的信息比一句"服务器内部错误"有用得多。
 *
 * `tag` 由调用方给（如 `"[ai/plan]"`），保证这条日志和该路由其他日志同一个前缀。
 */
export async function withRequestId(
  req: Request,
  tag: string,
  handle: (requestId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestId = requestIdFrom(req.headers);
  try {
    const res = await handle(requestId);
    // 回给客户端：出错时用户能报出这个号，直接 grep 定位整条链路
    res.headers.set("x-request-id", requestId);
    return res;
  } catch (err) {
    logger.error({ err, requestId }, `${tag} 未捕获异常`);
    return NextResponse.json(
      { error: "服务器内部错误" },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}

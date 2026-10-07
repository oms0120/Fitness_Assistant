/**
 * 每次请求的关联 ID。
 *
 * 单独一个文件而不是塞进 `logger.ts`：发这个头的地方（`ragClient`）不该为了一个
 * 字符串工具去 import 一个 Node-only 的日志库；测试也只需要构造 `Headers`，
 * 不用构造 `Request`。
 */

/**
 * 采信入站 `x-request-id` 的白名单。
 *
 * 这个头是**调用方可控**的（反代 / 网关透传什么就是什么），直接塞进日志不安全。
 * 「不安全」具体指什么，实测过（Node 26 的 undici，见 `requestId.test.ts`）：
 *
 *   - 换行 / 回车（`\n` `\r`）**被 `Headers` 自己拒掉**（构造时直接 TypeError），
 *     所以「伪造一整条日志」这条路本来就不可达 —— 不用为它写正则，也别以为正则在挡它。
 *   - **ANSI 转义（`\x1b`）放行**，`a\x1bb` 原样通过。带这个的 ID 进了日志，
 *     在终端或某些日志查看器里能改颜色、改光标 —— 这是正则真正在挡的东西之一。
 *   - **长度无上限**，8 KB 的值照样通过。每行日志都背上 8 KB 垃圾，刷屏又费存储。
 *   - 其余可打印字符（引号、花括号、`../`）都放行。pino 的 JSON 编码会把引号转义掉，
 *     所以结构不会被破坏，但这种 ID 既没法 grep 也不像 ID。
 *
 * 结论：只认「短、且全是安全字符」，其余一律重新生成。ID 是给人看和给人 grep 的，
 * 没有理由接受一个 8 KB 的值。
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * 取本次请求的 ID：上游带了**形状合法**的就沿用（这是跨层、跨服务关联的前提），
 * 否则生成一个 UUID v4。
 *
 * `crypto.randomUUID()` 出来是 36 字符的 hex + 连字符，本身就在上面的字符集内，
 * 所以自己生成的 ID 再经过一次校验也不会被拒。
 */
export function requestIdFrom(headers: Headers): string {
  const inbound = headers.get("x-request-id")?.trim();
  return inbound && REQUEST_ID_PATTERN.test(inbound) ? inbound : crypto.randomUUID();
}

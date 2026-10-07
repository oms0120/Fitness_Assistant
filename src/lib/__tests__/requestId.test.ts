/**
 * `requestIdFrom` 的分支覆盖。纯函数，构造一个 `Headers` 就够，不需要任何 mock 基建。
 *
 * 这份测试顺带**钉住了平台行为**：「换行会被拒」不是我们的实现，是 undici 的
 * `Headers` 构造器。写进测试是因为它决定了正则该防什么、不该防什么 ——
 * 不知道这一点的人很容易以为正则在挡换行注入，然后哪天为了「简化」把它删掉。
 */
import { describe, expect, it } from "vitest";
import { requestIdFrom } from "@/lib/requestId";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function headers(value: string): Headers {
  return new Headers({ "x-request-id": value });
}

describe("requestIdFrom", () => {
  it("没带 x-request-id 时生成一个 UUID", () => {
    expect(requestIdFrom(new Headers())).toMatch(UUID);
  });

  it("形状合法的 x-request-id 原样沿用", () => {
    // 沿用是跨层关联的前提：网关已经发过号时，这条链路要能和它那边的日志对上
    const id = "trace-abc_123.XY:z";
    expect(requestIdFrom(headers(id))).toBe(id);
  });

  it("ANSI 转义被拒 —— Headers 放行它，所以这是正则真正在挡的东西", () => {
    // 实测 `a\x1bb` 能通过 Headers 构造。放进去能在终端或日志查看器里改颜色、改光标。
    const got = requestIdFrom(headers("a\x1bb"));
    expect(got).not.toContain("\x1b");
    expect(got).toMatch(UUID);
  });

  it("超长的 x-request-id 被拒 —— 长度没有别的上限", () => {
    expect(requestIdFrom(headers("a".repeat(65)))).toMatch(UUID);
    expect(requestIdFrom(headers("a".repeat(8192)))).toMatch(UUID);
  });

  it("64 字符正好在允许范围内", () => {
    const id = "a".repeat(64);
    expect(requestIdFrom(headers(id))).toBe(id);
  });

  it("含路径分隔符之类的字符被拒", () => {
    expect(requestIdFrom(headers("../../etc/passwd"))).toMatch(UUID);
    expect(requestIdFrom(headers('x","level":60'))).toMatch(UUID);
  });

  it("纯空白的 x-request-id 当作没带（Headers 会先把它裁成空串）", () => {
    expect(headers("   ").get("x-request-id")).toBe("");
    expect(requestIdFrom(headers("   "))).toMatch(UUID);
  });

  it("两次生成的 ID 不重复", () => {
    expect(requestIdFrom(new Headers())).not.toBe(requestIdFrom(new Headers()));
  });

  it("换行由 Headers 自己拒掉 —— 所以正则不必为它负责", () => {
    // 这条不测我们的代码，测的是「为什么我们的代码不用处理这种情况」
    expect(() => headers('ok\n{"level":30,"msg":"伪造的条目"}')).toThrow(TypeError);
    expect(() => headers("a\rb")).toThrow(TypeError);
  });
});

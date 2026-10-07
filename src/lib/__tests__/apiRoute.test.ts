/**
 * `withRequestId` 的三条性质，都是**三个路由共同依赖**、而路由本身测不到的东西。
 *
 * 不 mock：真 `Request`、真 `NextResponse`（Next 16 的 NextResponse 就是 Web Response
 * 之上的一层，Node 里直接可用）。只有日志那一条 spy 单例 —— 和 `guard.test.ts` 同一招，
 * 理由见 `logger.ts` 模块头（level 方法是实例上 writable + configurable 的自有属性）。
 *
 * 为什么要单独测这层而不是靠路由的 e2e：路由全都卡 `auth()`，没有会话就只走得到 401，
 * 而 401 恰好不经过 catch。**catch 分支是这个包装里唯一没有其他路径能覆盖的**。
 */
import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { withRequestId } from "@/lib/apiRoute";
import { logger } from "@/lib/logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ai/plan", { method: "POST", headers });
}

/** 成功路径：handle 返回什么就回什么。 */
const ok = async () => NextResponse.json({ hello: "world" });

describe("withRequestId", () => {
  it("把入站的 x-request-id 原样回显 —— 跨层关联就靠这个头原样穿越", async () => {
    const res = await withRequestId(post({ "x-request-id": "trace-abc-123" }), "[t]", ok);
    expect(res.headers.get("x-request-id")).toBe("trace-abc-123");
    expect(await res.json()).toEqual({ hello: "world" });
  });

  it("没有入站头时生成一个新号并回显，而不是回一个空头", async () => {
    const res = await withRequestId(post(), "[t]", ok);
    expect(res.headers.get("x-request-id")).toMatch(UUID_RE);
  });

  it("非法入站头不复用 —— 换成新号，攻击者给的串进不了响应头", async () => {
    const res = await withRequestId(post({ "x-request-id": "../../etc/passwd" }), "[t]", ok);
    const echoed = res.headers.get("x-request-id");
    expect(echoed).not.toBe("../../etc/passwd");
    expect(echoed).toMatch(UUID_RE);
  });

  it("handle 抛错时兜成 500，且**仍然**带上 request-id 头", async () => {
    // 这是整个包装存在的理由：抛出去会冒到 Next 的默认错误处理，那条路径既没有日志
    // 也没有响应头。删掉 catch 里的 `headers`，这条会红。
    const spy = vi.spyOn(logger, "error").mockImplementation(() => {});

    const res = await withRequestId(post({ "x-request-id": "trace-boom" }), "[t]", async () => {
      throw new Error("炸了");
    });

    expect(res.status).toBe(500);
    expect(res.headers.get("x-request-id")).toBe("trace-boom");
    expect(await res.json()).toEqual({ error: "服务器内部错误" });

    // 号必须同时进日志，否则客户端报得出号、服务端却 grep 不到
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "trace-boom" }),
      expect.stringContaining("[t]"),
    );
    spy.mockRestore();
  });
});

/**
 * 日志输出的真实验证：给 `createLogger` 塞一个真实可写 stream，断言写出来的 JSON。
 *
 * **不 mock。** 和 `claudeProvider.test.ts` 起真 `node:http` 假服务器是同一个思路 ——
 * 把 pino 本身 mock 掉，测的就是我自己写的一个假 pino，等于什么都没验。这里要验的
 * 恰恰是 pino 自己的行为：redact 认不认这条路径、`err` 这个 key 到底走不走错误序列化器、
 * 低于 level 的日志写不写。只有真跑一次 pino 才看得到。
 *
 * **同步可读。** pino 对自定义 destination 是同 tick 同步写的，所以调用完立刻能读整行；
 * 不需要 flush，也不需要定时器（仓库不用 fake timers）。
 *
 * `createLogger` 不碰 transport（那是单例的事），所以在 vitest 下（NODE_ENV=test）
 * 它的行为和在生产里完全一致 —— 这正是把 transport 从工厂里拆出去的理由。
 */
import { describe, expect, it } from "vitest";
import { createLogger, REDACT_PATHS } from "@/lib/logger";

/** 接住 pino 写出来的每一行。 */
function collector() {
  const lines: string[] = [];
  const stream = {
    write: (s: string) => {
      lines.push(s);
    },
  };
  return {
    stream,
    lines,
    /** 顺带把「每行都是合法 JSON」也验了。 */
    records: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

type Collector = ReturnType<typeof collector>;

function loggerWith(c: Collector, level = "info") {
  return createLogger({ level }, c.stream);
}

describe("createLogger", () => {
  it("字段和消息写成一行合法 JSON", () => {
    const c = collector();
    loggerWith(c).info({ requestId: "abc-123" }, "[ai/plan] AI 生成失败");

    expect(c.lines).toHaveLength(1);
    expect(c.records()[0]).toMatchObject({
      level: 30, // pino 的 info
      requestId: "abc-123",
      msg: "[ai/plan] AI 生成失败",
    });
  });

  it("redact 把敏感字段换成 [REDACTED]，值一个都不漏", () => {
    const c = collector();
    loggerWith(c).info({
      question: "深蹲时膝盖疼，我住在朝阳区",
      email: "someone@example.com",
      password: "hunter2",
      authorization: "Bearer sk-live-xxx",
    });

    const rec = c.records()[0];
    expect(rec.question).toBe("[REDACTED]");
    expect(rec.email).toBe("[REDACTED]");
    expect(rec.password).toBe("[REDACTED]");
    expect(rec.authorization).toBe("[REDACTED]");
    for (const leak of ["深蹲", "朝阳区", "someone@example.com", "hunter2", "sk-live-xxx"]) {
      expect(c.lines[0]).not.toContain(leak);
    }
  });

  it("redact 命中两层嵌套 —— next-auth 的会话就是 session.user.email 这个形状", () => {
    const c = collector();
    loggerWith(c).info({ session: { user: { email: "someone@example.com" } } });

    expect(c.lines[0]).not.toContain("someone@example.com");
    expect(c.lines[0]).toContain("[REDACTED]");
  });

  it("每个敏感字段都铺到了三层深度", () => {
    // 直接断言配置形状，不必为每种嵌套都真打一条日志。
    // 把 `*.*.x` 那一档删掉，这条会红 —— 而上面那条嵌套用例也会红。
    for (const key of ["password", "email", "token", "question"]) {
      expect(REDACT_PATHS).toContain(key);
      expect(REDACT_PATHS).toContain(`*.${key}`);
      expect(REDACT_PATHS).toContain(`*.*.${key}`);
    }
  });

  it("err 走错误序列化器：拿得到 message 和 stack，而不是 {}", () => {
    const c = collector();
    loggerWith(c).error({ err: new Error("炸了") }, "[ai] 失败");

    // 钉的是「打点必须用 `err` 这个键名」这条约定：pino 只对 `err` 走错误序列化器
    // （见 logger.ts 里那段说明），写成 `error` 会被 JSON.stringify 成 {}，
    // message 和 stack 全丢 —— 恰是排查时要看的两样。
    const err = c.records()[0].err as { type: string; message: string; stack: string };
    expect(err.message).toBe("炸了");
    expect(err.type).toBe("Error");
    expect(err.stack).toContain("Error");
  });

  it("低于 level 的日志不写出", () => {
    const c = collector();
    const log = loggerWith(c, "warn");
    log.debug("看不见");
    log.info("也看不见");
    expect(c.lines).toHaveLength(0);

    log.warn("看得见");
    expect(c.lines).toHaveLength(1);
  });

  it("每行都以换行结束 —— 否则多条日志会粘成一行，JSON 就废了", () => {
    const c = collector();
    const log = loggerWith(c);
    log.info("一");
    log.info("二");

    expect(c.lines).toHaveLength(2);
    expect(c.lines.every((l) => l.endsWith("\n"))).toBe(true);
  });
});

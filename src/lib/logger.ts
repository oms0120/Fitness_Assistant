/**
 * 结构化日志。生产输出单行 JSON 到 stdout，开发用 pino-pretty 着色。
 *
 * ## 为什么生产是 JSON
 *
 * 改造前全仓是 `console.error("[tag]", e)` —— 一行非结构化文本。同一批请求里
 * 「哪几条日志属于同一次请求」只能靠时间戳猜，过滤只能 grep 字符串。
 * 换成 JSON 之后 `requestId` 是个字段，`jq 'select(.requestId=="…")'` 就能把
 * 一次请求穿过 路由 → 预算 → 检索 → LLM → 记账 五层的所有日志捞出来。
 *
 * ## 开发为什么用 transport，而不是直接 import pino-pretty
 *
 * `pino-pretty` 是 **devDependency**，而 Next 会把这类包 externalize 成运行时的
 * `require("pino-pretty")`（见 `next/dist/lib/server-external-packages.jsonc`，
 * 里面列着 `pino` / `pino-pretty` / `thread-stream`）。于是若在模块顶层静态 import 它，
 * 生产部署（`npm ci --omit=dev`，没有 devDeps）一加载本模块就 **MODULE_NOT_FOUND** ——
 * 而三个 AI 路由全都 import 本模块，等于整个 AI 面全部 500。
 *
 * `transport: { target: "pino-pretty" }` 里的 target 只是一个**字符串**，由 worker
 * 在运行时懒解析，且只在 isDev 时才构造那段配置：既不进 bundle，生产也永不 require 它。
 *
 * ### 但这个字符串 target 在 next dev 下解析不了
 *
 * pino 拿到字符串 target 后是这样找包的（`pino/lib/transport.js` 的 `fixTarget`）：
 * 从**调用栈**里逐个取调用者的文件路径，用 `createRequire(那个路径).resolve(target)`。
 * 打包器给的调用栈是虚拟路径，逐个解析全部失败，于是抛
 * `unable to determine transport target for "pino-pretty"`（已实测，三个路由全 500）。
 *
 * `fixTarget` 的第一行就是 `if (isAbsolute(origin)) return origin` —— 所以**给绝对路径**
 * 就整段跳过了栈解析。路径用 `createRequire(项目根/package.json)` 算：
 * 不用 `import.meta.url`，因为它在打包产物里同样可能是虚拟的，而项目根是进程启动时
 * 就确定的事实。
 *
 * ## 单例钉在 globalThis 上
 *
 * dev 的 transport 会起一个 worker 线程；HMR 重跑本模块会再起一个，旧的不会自己退出，
 * 改几次 logger.ts 就漏几个 worker。同 `rateLimit.ts` / `prisma.ts`：把首次实例钉住。
 *
 * ## 测试怎么打这条链
 *
 * 仓库禁止 `vi.mock`，所以工厂 `createLogger(opts, stream)` 收一个真实可写 stream，
 * 测试断言写出来的 JSON。工厂**绝不碰 transport** —— 一是 pino 不允许 transport 与
 * 自定义 stream 同时给，二是这样工厂在任何 NODE_ENV 下行为一致，测试才可靠。
 * 需要拦单例的话 `vi.spyOn(logger, "error")` 可用：pino 把 level 方法定义成实例上
 * writable + configurable 的自有属性（已实测，不是推测）。
 *
 * ## redact 的能力边界（重要，别误以为它兜住了）
 *
 * redact 是**按字段名**匹配结构化对象里的值，它**不扫描自由文本** ——
 * `err.message`、`err.stack`、`msg` 里夹带的用户内容都不会被打码。
 * 所以真正的规矩是：**不要把用户内容拼进 msg，也不要拼进抛出的错误消息里**。
 * 下面那张表是第二道防线，不是唯一防线。
 */
import { createRequire } from "node:module";
import { join } from "node:path";
import pino from "pino";
import type { DestinationStream, Logger, LoggerOptions } from "pino";

export type { Logger };

/**
 * 「一旦出现在日志里就是事故」的字段名。
 *
 * 凭据：Auth.js 的 credentials 就在这个形状上。
 * PII：这个应用里唯一真实的个人身份信息。
 * 会话头：现在没有一处会记录请求头，但记错一次的代价不可逆。
 * 用户自由文本：`/api/rag/ask` 的提问正文，最可能夹带个人信息。
 */
const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "email",
  "token",
  "authorization",
  "cookie",
  "question",
] as const;

/**
 * 每个字段名铺到三层深度：`x` / `*.x` / `*.*.x`。
 *
 * 铺到两层不是凑数 —— next-auth 的会话就是 `session.user.email` 这个形状，
 * 只写 `*.email` 的话它原样漏出去。fast-redact 的 `*` 只匹配一层，所以要逐层列。
 * 三层以上不再覆盖（没有这种形状，而且路径数量会翻倍）；真要日志里出现更深的
 * 嵌套对象，那是该改日志调用点、而不是继续加路径。
 *
 * 导出是为了让测试能直接断言覆盖深度，不必每次都真打一条日志去试。
 */
export const REDACT_PATHS = SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

/**
 * `level` 在这里读一次 env —— 这是**有意的例外**，不是漏了仓库那条「懒读 env」的规矩
 * （见 `usage.ts` 的说明：脚本先 import 再 `process.loadEnvFile()`）。pino 的 level
 * 只能在构造时给，没有回调形式，想懒读就得在每次打点前重设，得不偿失。
 *
 * 代价写明：`scripts/*.ts` 里 `.env` 的 `LOG_LEVEL` 不生效，脚本一律按 info 走。
 * 而已有的打点全是 warn/error，本来就高于 info，所以脚本的实际输出不受影响。
 */
const BASE_OPTIONS: LoggerOptions = {
  level: process.env.LOG_LEVEL?.trim() || "info",
  redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
  // 这里**故意不写 serializers**。pino 的默认序列化器集合里已经装了整个
  // pino-std-serializers（`pino.js` 的 `Object.assign(Object.create(null), stdSerializers)`），
  // 其中就有 `err`；而且传 serializers 时 pino 是**先铺默认值再覆盖**（`proto.js`），
  // 不是替换 —— 所以写 `serializers: { err: pino.stdSerializers.err }` 是纯粹的空操作。
  //
  // 但**键名必须叫 `err`** 这点是真的：`tools.js` 里是 `key === 'err'` 这个特判在
  // 走错误序列化器。写成 `logger.error({ error: e })` 的话，Error 会被 JSON.stringify
  // 成 `{}`，message 和 stack 全丢 —— 恰是排查时要看的两样。这条由 logger.test.ts 钉住。
};

/** 工厂。传了 stream 就写 stream（测试用），否则写 pino 的默认目标（stdout）。 */
export function createLogger(opts?: LoggerOptions, stream?: DestinationStream): Logger {
  const merged = { ...BASE_OPTIONS, ...opts };
  return stream ? pino(merged, stream) : pino(merged);
}

/**
 * 必须是 `=== "development"`，**不是** `!== "production"`。
 *
 * `scripts/eval-answer.ts` / `verify-usage.ts` 走 tsx，NODE_ENV 是 **undefined**；
 * 写成 `!== "production"` 会把它们判成开发模式，于是每次都 spawn 一个 pino-pretty
 * worker，还要把 JSON 换成彩色文本去混它们手工格式化的 `[eval] N/M` 进度行。
 *
 * `next dev` 自己设 development，`next start` 设 production，vitest 设 test —— 三个都对。
 */
const isDev = process.env.NODE_ENV === "development";

function buildSingleton(): Logger {
  if (!isDev) return createLogger();

  // 见模块头「但这个字符串 target 在 next dev 下解析不了」。**必须在 dev 分支里算** ——
  // 生产走不到这行，也就永远不会因为没装 pino-pretty（devDependency）而抛。
  const pinoPrettyPath = createRequire(join(process.cwd(), "package.json")).resolve("pino-pretty");

  return pino(
    BASE_OPTIONS,
    pino.transport({
      target: pinoPrettyPath,
      options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
    }),
  );
}

const globalForLogger = globalThis as unknown as { appLogger?: Logger };

export const logger: Logger =
  globalForLogger.appLogger ?? (globalForLogger.appLogger = buildSingleton());

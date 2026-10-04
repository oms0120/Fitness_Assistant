#!/usr/bin/env node
/**
 * 用 rag-service 的 venv python 跑脚本，跨平台。
 *
 *   node scripts/py.mjs rag-service/eval/run_retrieval_eval.py --golden ...
 *
 * 为什么不直接在 package.json 里写 venv 的路径：
 *   - Windows 的 cmd 把路径里的 `/` 当参数分隔符，不认正斜杠，加引号也没用
 *     （npm 用 `cmd /d /s /c "<script>"` 包装，引号会被拆掉），只能写反斜杠；
 *   - 反斜杠在 macOS/Linux 上又跑不通，而 `eval:retrieval` 不需要 LLM key，
 *     是要进 CI 的（ubuntu runner）。
 * 这里用 spawn 传参数组，不经过任何 shell，两个平台都不需要操心转义。
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const python = path.join(
  repoRoot,
  "rag-service",
  ".venv",
  isWindows ? "Scripts" : "bin",
  isWindows ? "python.exe" : "python",
);

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("[py] 用法: node scripts/py.mjs <脚本路径> [参数...]");
  process.exit(2);
}

// cwd 固定在仓库根：Python 脚本各自用 __file__ 定位自己的资源，与调用目录无关
const result = spawnSync(python, args, { stdio: "inherit", cwd: repoRoot });

if (result.error) {
  console.error(
    `[py] 起不来 ${python}\n     ${result.error.message}\n` +
      "     先建 venv：cd rag-service && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt",
  );
  process.exit(2);
}
process.exit(result.status ?? 1);

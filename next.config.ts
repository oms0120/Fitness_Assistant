import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 开 standalone 输出：`next build` 会额外产出 `.next/standalone`（含一个最小
   * `server.js` 和追踪到的 `node_modules` 子集），Dockerfile 只拷它，不拷整个
   * `node_modules`。
   *
   * **必须写死在配置里，不能做成 build arg。** 这是纯配置开关，没有对应的环境
   * 变量；做成开关就会出现"Docker 能开、宿主机 `npm run build` 不能开"，两边产物
   * 不一致，而且症状是 `COPY --from=builder .next/standalone` 直接构建失败，
   * 排查时容易误以为是 Dockerfile 的问题。
   *
   * 对宿主机的影响：`npm run build` 现在会多写一个 `.next/standalone` 目录
   * （`.next/` 本来就在 .gitignore 里）。`npm run dev` / `npm start` 完全不受影响。
   */
  output: "standalone",
};

export default nextConfig;

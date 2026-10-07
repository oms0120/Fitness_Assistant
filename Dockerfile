#
# 三阶段。builder 阶段**兼作 migrate 镜像**（见 docker-compose.yml）：prisma CLI
# 是 devDependency，`npm ci --omit=dev` 之后就没有了，而 `prisma migrate deploy`
# 又要靠它。
#
# 用 Debian slim 而不是 alpine：Prisma 官方不为 musl 出 engine，alpine 上得额外
# 装 openssl + libc6-compat 还不一定对得上 target 名。
# 版本跟随 package.json 的 engines 无约束，取当前的 LTS。
#
# **不写 `# syntax=docker/dockerfile:1`**：本文件没用任何 BuildKit 专属语法
# （heredoc / RUN --mount / COPY --link 都没有），加那行只会多一个「每次构建都要
# 去 Docker Hub 解析 frontend 镜像」的外部依赖，而且它钉在会漂移的 `1` 标签上。
# 去掉之后构建少一次 registry 往返，也没了那类"网络一抖就构建不了"的失败面。

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
# prisma 靠 `openssl version` 探测目标平台；slim 镜像里没有这个可执行文件，
# 探测失败会猜一个错的引擎名，运行时才报 "could not locate the Query Engine"。
# 装它，比往 schema 加 binaryTargets 好 —— 后者会让宿主机的 prisma generate
# 也白下 20MB Linux 引擎，为一个只跟镜像有关的约束污染开发机。
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 必须在 Linux 里 generate：本机 node_modules 里是 query_engine-windows.dll.node，
# 直接用会得到一个装不进 Linux 容器的镜像。
RUN npx prisma generate
RUN npm run build

# 断言 standalone 里没有**绝对**符号链接、也没有死链。
#
# 这是"确认本来就没问题"，不是修复。Next 在 Linux 上生成的是**相对**链接：
#   .next/node_modules/pino-<hash> -> ../../node_modules/pino
# 解析到 standalone 里那份被追踪的拷贝，自洽且可移植。
#
# 为什么曾经以为要修：在 Windows 开发机上，同样这两条链接是**绝对路径**
# （/f/.../node_modules/pino）。根因在 next/dist/build/utils.js 的 copyTracedFiles ——
# 它把 traced 文件的链接用 `readlink()` 读出来再 `symlink()` **原文照抄**，
# 而 Windows 建目录链接要管理员权限，EPERM 时回退成 junction，junction 只接受绝对目标。
# 于是"绝对路径"是 NTFS junction 的产物，跟 Linux 镜像无关。当初据此设计的
# "就地展开成实体拷贝"既没必要、又要多付 ~74MB（58M 追踪拷贝变死重量 + 74M 源包）。
#
# 留着断言，是因为它便宜，且能抓住"将来某个 Next 版本改成写绝对链接"这类回归：
#   -lname '/*'  不许有绝对链接。`-xtype l` 抓不到这个 —— 绝对链接在构建机上
#                指向的 node_modules 就在旁边，永远不"断"。
#   -xtype l     不许有死链。
# 真触发时的退路：用 realpath --relative-to 把绝对前缀改写成相对，或 `cp -aL` 展开。
RUN set -e; \
    absolute=$(find .next/standalone -type l -lname '/*'); \
    if [ -n "$absolute" ]; then \
      echo "standalone 里有绝对链接，镜像会带上构建机路径：" >&2; \
      echo "$absolute" >&2; \
      echo "退路：改成相对链接，或展开成实体拷贝（+~74MB）。" >&2; \
      exit 1; \
    fi; \
    broken=$(find .next/standalone -xtype l); \
    if [ -n "$broken" ]; then \
      echo "standalone 里有死链，镜像会在运行时 MODULE_NOT_FOUND：" >&2; \
      echo "$broken" >&2; \
      exit 1; \
    fi; \
    echo "符号链接检查通过：$(find .next/standalone -type l | wc -l) 条，全部相对且可解析"; \
    find .next/standalone -type l -exec sh -c 'for l do echo "  $l -> $(readlink "$l")"; done' _ {} +

FROM node:22-bookworm-slim AS runner
WORKDIR /app
# 运行时也要：Prisma Client 靠 dlopen 加载同一个引擎，缺 libssl 会报
# "libssl.so.3: cannot open shared object file"
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# 下面这个 HOSTNAME 只是兜底。生成的 server.js 是 `process.env.HOSTNAME || '0.0.0.0'`，
# 而 Docker 在创建容器时会注入 HOSTNAME（容器 ID / IP），**盖掉镜像的 ENV** ——
# 真正生效的是 docker-compose.yml 里那份。绑到容器 IP 上的症状是端口映射了但不应答。
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# standalone 不含 public/ 和 .next/static，server.js 需要它们才认
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 命名卷挂载点。镜像里不预置库文件 —— 库由 migrate 服务建在卷上。
#
# 这里**不切 USER node**：命名卷首次创建时是 root 所有，非 root 写 SQLite 会失败，
# 而卷已存在时镜像里的 chown 不会重跑（改完要 `docker compose down -v` 才生效），
# 是个很难查的坑。本地验证用的 compose，去掉这一整类问题。要收紧的话得同时处理
# 卷所有权和重建流程。
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "server.js"]

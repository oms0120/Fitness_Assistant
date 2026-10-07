# rag-service 检索服务。build context 是 ./rag-service（不是仓库根），
# 所以根目录那份 .dockerignore 对它无效，旁边的 rag-service/.dockerignore 才管用。
#
# 基础镜像用 3.13 而不是本机 venv 的 3.14：要保证 onnxruntime / tokenizers 有
# manylinux 轮子，3.13 是确定有的。embedding 走 Ollama HTTP，Python 小版本不影响
# 向量值；rerank 的行为由锁死的 onnxruntime / tokenizers 版本决定。
# 若某个 pin 在 3.13 上没有轮子，换成 python:3.14-slim。
FROM python:3.13-slim

WORKDIR /app

# onnxruntime 的 manylinux 轮子链 libgomp.so.1，slim 基础镜像里没有这个包
# （它跟着 gcc 运行时走，不在 debian-slim 的基底里）。
#
# 注意 rerank.py 是**懒加载** onnxruntime 的（在 _load() 里 import，不在顶层），
# 所以缺它**不会**让容器起不来 —— 是切到 hybrid+rerankN 时静默降级回 base 模式，
# 只在响应里多一个 rerank_error 字段。不专门去查，基本不会往"镜像少个 .so"上想。
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# 先只拷 requirements：改 .py 不该让这层 pip 缓存失效
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 构建期就把运行时要用的包 import 一遍。上面那条 libgomp1 是猜的（本机是 Windows
# 轮子，验不了 Linux 的 .so 依赖），这道冒烟把它从"运行到 rerank 才发现"提前成
# "构建就红"。只 import，不加载模型 —— 模型在 models/ 里，是绑定挂载，构建期不存在。
RUN python -c "import numpy, onnxruntime, tokenizers, fastapi, uvicorn, requests; print('[build] runtime deps ok', onnxruntime.__version__, tokenizers.__version__)"

# 只拷服务真正 import 的四个文件。ocr.py / ingest.py 留在宿主机跑 ——
# 它们要 pypdf / rapidocr（会拖进 opencv + shapely + pyclipper + pillow），
# 服务器进程一行都不 import，装进来只是让镜像大一倍。
COPY bm25.py embedding.py rerank.py server.py ./

# 再冒一次烟，这次连本地模块一起：能抓住漏拷文件、写错的相对 import。
# server.py 模块级只建 FastAPI 实例和常量，不碰数据库、不发 HTTP。
RUN python -c "import bm25, embedding, rerank, server; print('[build] service modules ok')"

# server.py 的 `__main__` 里写死了 host=127.0.0.1（给宿主机直跑用的），
# 容器里那样绑就没人能访问到，必须在这里显式 --host 0.0.0.0。
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]

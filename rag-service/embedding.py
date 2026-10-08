"""Ollama embedding 客户端（bge-m3）。server.py 与 ingest.py 共用。

前置条件：
  ollama serve            # 启动本地服务（默认 127.0.0.1:11434）
  ollama pull bge-m3      # 拉取模型（约 1.2GB）
"""
import os

import numpy as np
import requests

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
EMBED_MODEL = os.environ.get("OLLAMA_EMBED_MODEL", "bge-m3")
EMBED_DIM = 1024  # bge-m3 dense 向量维度，用于校验索引是否过期

# 让 Ollama 把模型**常驻**内存，而不是空闲 5 分钟就卸载。
#
# 不设的话，每段空闲之后第一次问答都要冷加载 bge-m3（1.1GB，实测 4~22s，
# 波动取决于 Windows 文件缓存是否还持有那个模型文件），而 Node 侧
# `src/lib/rag/ragClient.ts` 的 RAG_TIMEOUT_MS 默认只有 15s —— 超时后 app
# 静默降级成"没有检索到文档片段"，表现是**第一次问答丢掉全部出处、再问一次就正常**。
# 这条链路按设计不报错，所以症状很像"检索效果不好"，很容易查错方向。
#
# 取值：Ollama 接受负数（永不卸载）或时长字符串（"24h" / "30m"）。
# 默认 -1 —— 这个进程存在的意义就是随时能 embed，用 1.1GB 常驻换掉每次冷启动
# 十几秒是划算的。想收紧内存就设 OLLAMA_KEEP_ALIVE=30m 这类值。
def _parse_keep_alive(raw: str) -> int | str:
    """把环境变量转成 Ollama 期望的类型。

    `keep_alive` 在 Ollama 侧是 Go 的 time.Duration：JSON **数字按秒**解释，
    **字符串走 time.ParseDuration**（必须有单位 —— "30m" 行，"30" 不行）。
    所以裸整数发数字、其余原样发字符串。

    类型发错**不会报错**：Ollama 解析不了就静默套用默认的 5 分钟，
    问题原样保留、还看不出哪里错了。所以这里显式区分。
    """
    raw = raw.strip()
    try:
        return int(raw)
    except ValueError:
        return raw


KEEP_ALIVE = _parse_keep_alive(os.environ.get("OLLAMA_KEEP_ALIVE", "-1"))


class EmbeddingError(RuntimeError):
    """Ollama 不可用、模型缺失或返回异常。"""


def embed_batch(texts: list[str], timeout: int = 120) -> list[np.ndarray]:
    """批量取 embedding，返回 L2 归一化后的向量（点积 = 余弦相似度）。"""
    if not texts:
        return []

    try:
        res = requests.post(
            f"{OLLAMA_BASE_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": texts, "keep_alive": KEEP_ALIVE},
            timeout=timeout,
        )
    except requests.RequestException as exc:
        raise EmbeddingError(
            f"连接 Ollama 失败（{OLLAMA_BASE_URL}），请先执行 `ollama serve`：{exc}"
        ) from exc

    if res.status_code == 404:
        raise EmbeddingError(
            f"Ollama 中没有模型 {EMBED_MODEL}，请先执行 `ollama pull {EMBED_MODEL}`"
        )
    if not res.ok:
        raise EmbeddingError(f"Ollama 返回 {res.status_code}: {res.text[:200]}")

    embeddings = res.json().get("embeddings")
    if not embeddings:
        raise EmbeddingError(f"Ollama 返回内容缺少 embeddings 字段: {res.text[:200]}")

    out = []
    for item in embeddings:
        vec = np.asarray(item, dtype=np.float32)
        norm = float(np.linalg.norm(vec))
        out.append(vec / norm if norm > 0 else vec)
    return out


def embed(text: str, timeout: int = 60) -> np.ndarray:
    """单条 embedding。"""
    return embed_batch([text], timeout=timeout)[0]

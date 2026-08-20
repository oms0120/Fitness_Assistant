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


class EmbeddingError(RuntimeError):
    """Ollama 不可用、模型缺失或返回异常。"""


def embed_batch(texts: list[str], timeout: int = 120) -> list[np.ndarray]:
    """批量取 embedding，返回 L2 归一化后的向量（点积 = 余弦相似度）。"""
    if not texts:
        return []

    try:
        res = requests.post(
            f"{OLLAMA_BASE_URL}/api/embed",
            json={"model": EMBED_MODEL, "input": texts},
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

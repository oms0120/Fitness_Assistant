"""RAG embedding + 检索服务（FastAPI）。embedding 由本地 Ollama 的 bge-m3 提供。

前置条件见 embedding.py；向量库由 ingest.py 生成。
"""
import os
import sqlite3

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from embedding import EMBED_MODEL, EmbeddingError, embed

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "vectors.db")

app = FastAPI(title="fitness-rag")


class EmbedRequest(BaseModel):
    text: str


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@app.post("/embed")
def do_embed(req: EmbedRequest):
    try:
        vec = embed(req.text)
    except EmbeddingError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"embedding": vec.tolist(), "dim": int(len(vec)), "model": EMBED_MODEL}


@app.post("/search")
def search(req: SearchRequest):
    if not os.path.exists(DB_PATH):
        return {"results": [], "error": "vectors.db 不存在，请先运行 ingest.py"}

    try:
        qvec = embed(req.query)
    except EmbeddingError as exc:
        # 返回 200 + error，让前端按"检索不到"降级而不是整个请求失败
        return {"results": [], "error": str(exc)}

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, text, source, meta, embedding FROM chunks").fetchall()
    conn.close()
    if not rows:
        return {"results": []}

    indexed_dim = len(rows[0][4]) // np.dtype(np.float32).itemsize
    if indexed_dim != len(qvec):
        return {
            "results": [],
            "error": (
                f"向量库维度 {indexed_dim} 与当前模型 {EMBED_MODEL}（{len(qvec)} 维）不一致，"
                "请重新运行 ingest.py 重建索引"
            ),
        }

    results = []
    for id_, text, source, meta, emb_blob in rows:
        emb = np.frombuffer(emb_blob, dtype=np.float32)
        sim = float(np.dot(qvec, emb))
        results.append({"id": id_, "text": text, "source": source, "meta": meta, "score": sim})
    results.sort(key=lambda x: -x["score"])
    return {"results": results[: req.top_k]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)

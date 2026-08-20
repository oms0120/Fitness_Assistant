"""RAG embedding + 检索服务（FastAPI）。

首次运行会从 HuggingFace 下载 bge-small-zh 模型（约 100MB）。
国内网络可先设置环境变量：HF_ENDPOINT=https://hf-mirror.com
"""
import os
import sqlite3
import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

# 离线模式：模型已缓存，避免加载时联网卡住（首次运行需先在线下载模型）
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
DB_PATH = os.path.join(os.path.dirname(__file__), "data", "vectors.db")

print(f"[rag] loading model {MODEL_NAME} ...")
model = SentenceTransformer(MODEL_NAME)
print("[rag] model loaded")

app = FastAPI(title="fitness-rag")


class EmbedRequest(BaseModel):
    text: str


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5


@app.post("/embed")
def embed(req: EmbedRequest):
    vec = model.encode(req.text, normalize_embeddings=True).astype(np.float32)
    return {"embedding": vec.tolist(), "dim": int(len(vec))}


@app.post("/search")
def search(req: SearchRequest):
    qvec = model.encode(req.query, normalize_embeddings=True).astype(np.float32)
    if not os.path.exists(DB_PATH):
        return {"results": [], "error": "vectors.db 不存在，请先运行 ingest.py"}

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, text, source, meta, embedding FROM chunks").fetchall()
    conn.close()
    if not rows:
        return {"results": []}

    results = []
    for id_, text, source, meta, emb_blob in rows:
        emb = np.frombuffer(emb_blob, dtype=np.float32)
        # normalize_embeddings=True 时，余弦相似度 = 点积
        sim = float(np.dot(qvec, emb))
        results.append({"id": id_, "text": text, "source": source, "meta": meta, "score": sim})
    results.sort(key=lambda x: -x["score"])
    return {"results": results[: req.top_k]}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)

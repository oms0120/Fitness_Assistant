"""RAG embedding + 检索服务（FastAPI）。embedding 由本地 Ollama 的 bge-m3 提供。

前置条件见 embedding.py；向量库由 ingest.py 生成。

检索两种模式，由 `RAG_RETRIEVAL_MODE` 或请求体的 `mode` 选择：
  dense   只走向量召回（改造前的行为）
  hybrid  向量召回 + BM25 稀疏召回，用 RRF 融合（见 bm25.py 的模块注释）
默认 hybrid，是量出来的不是猜的（`eval/run_retrieval_eval.py --compare`，110 条 golden、
候选池 100/路）：recall@5 0.827 → 0.909，recall@20 0.945 → 1.000，MRR@5 0.687 → 0.733，
中位耗时 60 → 61 ms。收益集中在 numeric 桶（0.760 → 0.880）—— 数字和专名正是
bi-encoder 排不准、BM25 认得住的那类。
"""
import os
import sqlite3
from collections import defaultdict

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import bm25 as bm25_mod
from embedding import EMBED_MODEL, EmbeddingError, embed

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "vectors.db")

RETRIEVAL_MODE = os.environ.get("RAG_RETRIEVAL_MODE", "hybrid")
# 融合前每一路各取多少条。线上 top_k=5，取 50 是在"池子够大"和"白算无用功"之间取的值。
CANDIDATES = 50
# RRF 的平滑常数。取 60 是文献惯例：它让前几名的 1/(k+rank) 差距平缓，
# 单路排第 1 不会因为常数太小而垄断融合结果。
RRF_K = 60

app = FastAPI(title="fitness-rag")


class EmbedRequest(BaseModel):
    text: str


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    # None = 用 RETRIEVAL_MODE / CANDIDATES。评测脚本要跑对照，所以做成可按请求覆盖。
    mode: str | None = None
    candidates: int | None = None


@app.post("/embed")
def do_embed(req: EmbedRequest):
    try:
        vec = embed(req.text)
    except EmbeddingError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"embedding": vec.tolist(), "dim": int(len(vec)), "model": EMBED_MODEL}


# ---------- 索引 ----------

_bm25_cache: dict = {"key": None, "index": None}


def _bm25_index() -> bm25_mod.Bm25Index:
    """BM25 倒排索引，进程内缓存。

    按 `vectors.db` 的 mtime + 文件大小判失效 —— 重跑 ingest.py 会重建这个库，
    索引必须跟着重建，否则 BM25 拿的是旧 id 和新文本的错配。
    """
    stat = os.stat(DB_PATH)
    key = (stat.st_mtime_ns, stat.st_size)
    if _bm25_cache["index"] is None or _bm25_cache["key"] != key:
        conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
        docs = conn.execute("SELECT id, text FROM chunks").fetchall()
        conn.close()
        index = bm25_mod.Bm25Index(docs)
        _bm25_cache["index"] = index
        _bm25_cache["key"] = key
        print(f"[server] BM25 索引已重建 {index.stats()}", flush=True)
    return _bm25_cache["index"]


def _load_rows() -> list[tuple]:
    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute("SELECT id, text, source, meta, embedding FROM chunks").fetchall()
    conn.close()
    return rows


def _dense_scores(qvec: np.ndarray, rows: list[tuple]) -> dict[int, float]:
    """全量点积。向量已 L2 归一化，所以点积就是余弦。"""
    out = {}
    for id_, _text, _source, _meta, emb_blob in rows:
        out[id_] = float(np.dot(qvec, np.frombuffer(emb_blob, dtype=np.float32)))
    return out


def _rrf_fuse(rankings: list[list[int]], top_k: int) -> list[tuple[int, float]]:
    """Reciprocal Rank Fusion：`score = Σ 1/(RRF_K + rank)`。

    只用名次不用分数，因为两路的分数不可比 —— 稠密侧是余弦（0~1 有界、区分度窄），
    稀疏侧是无上界的 BM25 分。想把它们归一化到同一尺度，就得引入一堆跟语料相关的
    调参；RRF 绕开这件事，代价是丢掉了"领先多少"的信息。
    """
    fused: dict[int, float] = defaultdict(float)
    for ranking in rankings:
        for rank, chunk_id in enumerate(ranking, start=1):
            fused[chunk_id] += 1.0 / (RRF_K + rank)
    return sorted(fused.items(), key=lambda kv: -kv[1])[:top_k]


# ---------- 检索 ----------

def search_chunks(
    query: str,
    top_k: int = 5,
    mode: str | None = None,
    candidates: int | None = None,
) -> dict:
    """向量化查询 → 召回 → 排序取 top-k。

    抽成独立函数是为了让 /search 端点与 eval 脚本共用同一份实现；
    否则 eval 测的是另一套逻辑，跟线上链路不是一回事。

    返回 {"results": [...], "error": str | None}，error 非空表示没检索到。
    每条 result 的 `score` 恒为**余弦相似度**，hybrid 模式下也一样 —— 融合名次另外
    放在 `rrf` 里。这样两种模式的 score 才可比，评测里的 top1_score 也才有意义。
    """
    if not os.path.exists(DB_PATH):
        return {"results": [], "error": "vectors.db 不存在，请先运行 ingest.py"}

    mode = mode or RETRIEVAL_MODE
    if mode not in ("dense", "hybrid"):
        return {"results": [], "error": f"未知的检索模式 {mode!r}，只支持 dense / hybrid"}
    n = max(candidates or CANDIDATES, top_k)

    try:
        qvec = embed(query)
    except EmbeddingError as exc:
        # 返回 200 + error，让前端按"检索不到"降级而不是整个请求失败
        return {"results": [], "error": str(exc)}

    rows = _load_rows()
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

    cos_of = _dense_scores(qvec, rows)
    dense_ranked = sorted(cos_of, key=lambda cid: -cos_of[cid])[:n]

    rrf_of: dict[int, float] = {}
    if mode == "dense":
        ranked = dense_ranked
    else:
        sparse_ranked = [cid for cid, _ in _bm25_index().search(query, n)]
        fused = _rrf_fuse([dense_ranked, sparse_ranked], n)
        rrf_of = dict(fused)
        ranked = [cid for cid, _ in fused]

    text_of = {id_: (text, source, meta) for id_, text, source, meta, _ in rows}
    results = []
    for cid in ranked[:top_k]:
        text, source, meta = text_of[cid]
        item = {"id": cid, "text": text, "source": source, "meta": meta, "score": cos_of[cid]}
        if mode == "hybrid":
            # 排名跃升最直观：稠密排第 42 的片段融合后进前 5，一眼看得出是 BM25 拉上来的
            item["dense_rank"] = dense_ranked.index(cid) + 1 if cid in dense_ranked else None
            item["rrf"] = rrf_of.get(cid)
        results.append(item)
    return {"results": results, "mode": mode}


@app.post("/search")
def search(req: SearchRequest):
    return search_chunks(req.query, req.top_k, req.mode, req.candidates)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)

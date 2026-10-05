"""RAG embedding + 检索服务（FastAPI）。embedding 由本地 Ollama 的 bge-m3 提供。

前置条件见 embedding.py；向量库由 ingest.py 生成。

检索三路召回 + 可选重排，由 `RAG_RETRIEVAL_MODE` 或请求体的 `mode` 选择：
  dense           只走向量召回（改造前的行为）
  bm25            只走 BM25 稀疏召回（用来把 hybrid 拆开做归因，线上不用）
  hybrid          向量召回 + BM25 稀疏召回，用 RRF 融合（见 bm25.py 的模块注释）
  <base>+rerankN  在 base 模式的结果上，取前 N 条交给 cross-encoder 重排（见 rerank.py）
默认 hybrid，是量出来的不是猜的（`eval/run_retrieval_eval.py --compare`，110 条 golden、
候选池 100/路）：recall@5 0.827 → 0.909，recall@20 0.945 → 1.000，MRR@5 0.687 → 0.733，
中位耗时 60 → 61 ms。收益集中在 numeric 桶（0.760 → 0.880）—— 数字和专名正是
bi-encoder 排不准、BM25 认得住的那类。

**池深必须 ≥50**：RRF 只看名次，候选池越浅，能积累"两路共识"的片段越少。实测 candidates
20 → recall@5 0.900（且 `diet-018` 的 gold 直接掉出池外），50 / 100 / 200 三者完全相同。
所以 rerank 的池是**融合结果的 top-N**，不是"把 candidates 调成 N"。
"""
import os
import re
import sqlite3
import time
from collections import defaultdict

import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

import bm25 as bm25_mod
import rerank as rerank_mod
from embedding import EMBED_MODEL, EmbeddingError, embed

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "vectors.db")

RETRIEVAL_MODE = os.environ.get("RAG_RETRIEVAL_MODE", "hybrid")
# 融合前每一路各取多少条。线上 top_k=5，取 50 是在"池子够大"和"白算无用功"之间取的值。
CANDIDATES = 50
# RRF 的平滑常数。取 60 是文献惯例：它让前几名的 1/(k+rank) 差距平缓，
# 单路排第 1 不会因为常数太小而垄断融合结果。
RRF_K = 60
# 重排模式下的最小融合深度。**比 CANDIDATES(50) 深**，因为重排的池取自融合结果的前 N 条，
# 而 RRF 只看名次、尾部名次对融合深度敏感：实测融合池 50 时 rerank 的 recall@5 是 0.936、
# 池 100 时是 0.955。多融合几十条的代价是零点几毫秒（点积和 BM25 都比 embedding 便宜一个
# 量级），所以重排模式一律按更深的池融合，把这个不确定因素去掉。
RERANK_FUSION_DEPTH = 100
# rerank 池深写进模式名（如 hybrid+rerank20）而不是做成独立开关，是为了让它直接穿过
# 所有已按 mode 分支的地方（白名单 / 评测的 MODES / 报告文件名）—— 否则池深不同的两次
# 评测会写到同一个报告文件上、静默互相覆盖。池深取 20 的依据：hybrid 下 10 条 miss 的
# gold 全在融合结果的前 20 位（最远 `diet-018` 第 20），池内 recall 上限就是 1.000。
_RERANK_RE = re.compile(r"^(dense|bm25|hybrid)\+rerank(\d+)$")
BASE_MODES = ("dense", "bm25", "hybrid")

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
    每条 result 的 `score` 恒为**余弦相似度**，hybrid / rerank 模式下也一样 —— 融合名次放在
    `rrf`、重排分放在 `rerank_score`。这样各模式的 score 才可比，评测里的 top1_score 也才有意义。
    """
    if not os.path.exists(DB_PATH):
        return {"results": [], "error": "vectors.db 不存在，请先运行 ingest.py"}

    t_start = time.perf_counter()
    # requested 是原样的模式名（可能带 +rerankN），要原样回显 —— 评测脚本拿它写报告文件名，
    # 回显 base mode 的话 `hybrid` 和 `hybrid+rerank20` 的两份报告会撞在同一个文件上。
    requested = mode or RETRIEVAL_MODE
    m = _RERANK_RE.match(requested)
    base_mode, rerank_pool = (m.group(1), int(m.group(2))) if m else (requested, 0)
    if base_mode not in BASE_MODES:
        return {
            "results": [],
            "error": f"未知的检索模式 {requested!r}，支持 {' / '.join(BASE_MODES)}（可加 +rerankN 后缀）",
        }
    n = max(candidates or CANDIDATES, top_k)
    if rerank_pool > 0:
        n = max(n, RERANK_FUSION_DEPTH)

    try:
        qvec = embed(query)
    except EmbeddingError as exc:
        # 返回 200 + error，让前端按"检索不到"降级而不是整个请求失败
        return {"results": [], "error": str(exc)}
    embed_ms = (time.perf_counter() - t_start) * 1000

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
    if base_mode == "dense":
        ranked = dense_ranked
    elif base_mode == "bm25":
        # 只走稀疏路。`score` 仍是余弦（见 docstring），但排序来自 BM25 ——
        # 这个模式下 top1_score 没有意义，它只用来做归因，不是可上线配置。
        ranked = [cid for cid, _ in _bm25_index().search(query, n)]
    else:
        sparse_ranked = [cid for cid, _ in _bm25_index().search(query, n)]
        fused = _rrf_fuse([dense_ranked, sparse_ranked], n)
        rrf_of = dict(fused)
        ranked = [cid for cid, _ in fused]

    text_of = {id_: (text, source, meta) for id_, text, source, meta, _ in rows}

    # ---- 重排 ----
    reranked = False
    rerank_error = None
    rerank_of: dict[int, float] = {}
    rerank_rank_of: dict[int, int] = {}
    rerank_ms = 0.0
    if rerank_pool > 0:
        pool = ranked[:rerank_pool]
        t0 = time.perf_counter()
        try:
            scores = rerank_mod.rerank_scores(query, [text_of[c][0] for c in pool])
        except rerank_mod.RerankError as exc:
            # 软降级：模型缺失/加载失败时按 base 模式照常返回，只把原因放进字段。
            # 与 embedding 失败同一个约定（200 + error），绝不能让它把整个问答打成 500。
            rerank_error = str(exc)
        else:
            order = sorted(range(len(pool)), key=lambda i: -scores[i])
            rerank_of = {cid: scores[i] for i, cid in enumerate(pool)}
            rerank_rank_of = {cid: i + 1 for i, cid in enumerate(pool)}
            # 池外的尾巴原样接回去：recall@k 曲线的 k>pool 段仍然有定义
            ranked = [pool[i] for i in order] + ranked[rerank_pool:]
            reranked = True
        rerank_ms = (time.perf_counter() - t0) * 1000

    results = []
    for cid in ranked[:top_k]:
        text, source, meta = text_of[cid]
        item = {"id": cid, "text": text, "source": source, "meta": meta, "score": cos_of[cid]}
        if base_mode == "hybrid":
            # 排名跃升最直观：稠密排第 42 的片段融合后进前 5，一眼看得出是 BM25 拉上来的
            item["dense_rank"] = dense_ranked.index(cid) + 1 if cid in dense_ranked else None
            item["rrf"] = rrf_of.get(cid)
        if reranked:
            item["rerank_score"] = rerank_of.get(cid)
            # 重排**前**在池内的名次，与 dense_rank 同一个用途：看它被提了多少位
            item["rerank_rank"] = rerank_rank_of.get(cid)
        results.append(item)

    out = {
        "results": results,
        "mode": requested,
        "timings": {"embed_ms": round(embed_ms, 1), "rerank_ms": round(rerank_ms, 1)},
    }
    if rerank_pool > 0:
        out["reranked"] = reranked
        out["rerank_pool"] = rerank_pool
        out["rerank_model"] = rerank_mod.MODEL_NAME
        if rerank_error:
            out["rerank_error"] = rerank_error
    return out


@app.post("/search")
def search(req: SearchRequest):
    return search_chunks(req.query, req.top_k, req.mode, req.candidates)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)

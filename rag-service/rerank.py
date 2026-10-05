"""Cross-encoder 重排（本地 ONNX，bge-reranker-base）。

为什么需要它：hybrid 把候选**找**对了，但**排**不对。`baseline-report.md` §4 第 3 条量到
29.1% 的提问 gold 进了 prompt 却混在第 2–5 位 —— 而 recall@5 对此完全无感，它只管
"在不在 top-5"。rerank 的靶子就是这批。

为什么是 cross-encoder 而不是再调一次 bi-encoder：bge-m3 把 query 和 chunk 各自编码成
一个向量，两者的交互只发生在最后那一次点积里 —— 这是它能毫秒级检索 1985 条的原因，也是
它对表格块、窗口边界片段系统性低估的原因（`baseline-report.md` §4 末）。cross-encoder 把
query 和 chunk **拼成一条序列**送进模型，每层注意力都能看到两边，代价是每条候选一次前向 ——
所以只能对候选池（20 条）做，不能对全库做。

为什么走 ONNX 而不是 sentence-transformers：本机是 Python 3.14，没有 torch 的轮子。
onnxruntime 已在依赖里（rapidocr_onnxruntime 带进来的），直接复用。

**本模块不在顶层 import onnxruntime / tokenizers** —— server.py 会顶层 `import rerank`，
延迟 import 才能保证"模型没下好"时 /search 照常按 hybrid 工作而不是整个服务起不来。
"""

import math
import os
import threading

MODEL_DIR = os.environ.get(
    "RAG_RERANK_MODEL_DIR",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "models", "bge-reranker-base"),
)
MODEL_FILE = os.environ.get("RAG_RERANK_MODEL_FILE", "onnx/model_quantized.onnx")
MODEL_NAME = os.environ.get("RAG_RERANK_MODEL_NAME", "bge-reranker-base")
# 16 条一批。CPU 上再大收益很小，而一次前向的峰值内存会随批量线性涨。
BATCH = int(os.environ.get("RAG_RERANK_BATCH", "16"))
# 不钉住的话 ORT 会吃掉所有核，和同进程的 uvicorn 抢 —— 本服务是单进程单 worker，
# 抢核只会让并发请求互相拖慢，不会提高吞吐。
THREADS = int(os.environ.get("RAG_RERANK_THREADS", "4"))
# cross-encoder 的标准上限。截断策略是 only_second（见 _ensure_loaded），
# 所以这是**文档侧**的上限，query 不会被截。
MAX_LENGTH = int(os.environ.get("RAG_RERANK_MAX_LENGTH", "512"))


class RerankError(RuntimeError):
    """模型缺失、加载失败或推理异常。调用方据此软降级回纯 hybrid。"""


_lock = threading.Lock()
# 双检锁缓存。**失败状态粘滞**：加载一旦失败就把 error 记下来，后续调用直接抛，
# 不再每请求去 stat 一次文件系统 —— 模型没下好是部署期的状态，不是每请求都会变的状态。
_state: dict = {"session": None, "tokenizer": None, "input_names": [], "output_name": None, "error": None}


def _ensure_loaded() -> tuple:
    """懒加载 ONNX session + tokenizer。已加载或已失败时是纯字典读，无锁开销。"""
    if _state["session"] is not None:
        return _state["session"], _state["tokenizer"]
    if _state["error"] is not None:
        raise RerankError(_state["error"])

    with _lock:
        # 双检：等锁期间可能已被另一个线程加载完
        if _state["session"] is not None:
            return _state["session"], _state["tokenizer"]
        if _state["error"] is not None:
            raise RerankError(_state["error"])
        try:
            _load()
        except Exception as exc:  # noqa: BLE001 —— 任何加载失败都该软降级，不该让 /search 挂掉
            _state["error"] = f"{type(exc).__name__}: {exc}"
            raise RerankError(_state["error"]) from exc
    return _state["session"], _state["tokenizer"]


def _load() -> None:
    from tokenizers import Tokenizer
    import onnxruntime as ort

    model_path = os.path.join(MODEL_DIR, MODEL_FILE)
    tok_path = os.path.join(MODEL_DIR, "tokenizer.json")
    for path in (model_path, tok_path):
        if not os.path.exists(path):
            raise RerankError(
                f"缺少 {path}。见 rerank.py 模块头：模型需下到 {MODEL_DIR}（该目录已 gitignore）"
            )

    tokenizer = Tokenizer.from_file(tok_path)
    pad_id = tokenizer.token_to_id("<pad>")
    if pad_id is None:
        raise RerankError("tokenizer 里没有 <pad> token，无法做动态 padding")
    # only_second：超长时截**文档**不截 query。宽池子里的候选是 400 字 chunk，
    # 加上 query 通常到不了 512，但一旦到了，截 query 会直接毁掉这次打分的依据。
    tokenizer.enable_truncation(max_length=MAX_LENGTH, strategy="only_second")
    tokenizer.enable_padding(direction="right", pad_id=pad_id)

    opts = ort.SessionOptions()
    opts.intra_op_num_threads = THREADS
    session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])

    # 输入名必须从图里读，不能硬编码。实测这个导出只有 input_ids + attention_mask，
    # **没有 token_type_ids** —— 喂了不存在的输入 ORT 会直接报错。
    _state["input_names"] = [i.name for i in session.get_inputs()]
    _state["output_name"] = session.get_outputs()[0].name
    _state["session"] = session
    _state["tokenizer"] = tokenizer
    print(
        f"[rerank] 已加载 {MODEL_NAME}（{MODEL_FILE}）inputs={_state['input_names']} "
        f"output={_state['output_name']} threads={THREADS}",
        flush=True,
    )


def _sigmoid(x: float) -> float:
    # 分段避免 exp 溢出：logits 在 int8 量化后可能跑到 ±30 以上
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


def rerank_scores(query: str, docs: list[str]) -> list[float]:
    """给每条候选打一个 0~1 的相关性分，**按输入顺序返回**。

    刻意不返回排好序的列表：调用方按位置持有 id / dense_rank / rrf，重排是它的事。
    返回按位置对齐的分数，调用方才能自己决定怎么合并、以及要不要保留尾巴。
    """
    if not docs:
        return []

    session, tokenizer = _ensure_loaded()
    import numpy as np

    scores: list[float] = []
    for start in range(0, len(docs), BATCH):
        batch = docs[start : start + BATCH]
        # 成对编码：(query, doc)。tokenizers 的 tuple 输入就是标准的 pair 编码，
        # 会自动插入 [CLS] q [SEP] d [SEP] 的模板。
        encodings = tokenizer.encode_batch([(query, d) for d in batch])
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)

        # 按图里**实际存在**的输入构造 feed，而不是照着记忆里的 BERT 签名喂。
        available = {"input_ids": ids, "attention_mask": mask, "token_type_ids": np.zeros_like(ids)}
        feed = {name: available[name] for name in _state["input_names"] if name in available}

        logits = session.run([_state["output_name"]], feed)[0]
        if logits.ndim == 2 and logits.shape[1] > 1:
            # 双标签头的（[not_rel, rel]）取正类那一列
            logits = logits[:, -1]
        scores.extend(_sigmoid(float(v)) for v in logits.reshape(-1))

    return scores


def stats() -> dict:
    """给 smoke test / 诊断用。不触发加载。"""
    return {
        "model_dir": MODEL_DIR,
        "model_file": MODEL_FILE,
        "model_name": MODEL_NAME,
        "loaded": _state["session"] is not None,
        "error": _state["error"],
        "input_names": _state["input_names"],
        "output_name": _state["output_name"],
        "batch": BATCH,
        "threads": THREADS,
        "max_length": MAX_LENGTH,
    }

"""候选池深度扫描：RRF 的融合池到底该取多深。

这个数不能靠猜，它同时决定两件事：
  - **融合质量**：RRF 的分数只来自名次（`Σ 1/(K+rank)`），池子越浅，能同时出现在
    两路里的片段越少，"共识"就越难积累。浅到一定程度，单路排第 1 的片段会被彻底挤出去。
  - **CPU 成本**：rerank 的池深直接等于要重排的条数，成本线性涨。

`--candidates` 在画 recall@k 曲线时是**失效的**（`search_chunks` 里 `n = max(candidates, top_k)`，
曲线用 top_k=100 把它顶掉了），所以池深必须单独扫。

  .venv/Scripts/python eval/pool_sweep.py
  .venv/Scripts/python eval/pool_sweep.py --depths 20,50,100,200
"""
import argparse
import datetime
import json
import os
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import search_chunks  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(ROOT)
DEFAULT_GOLDEN = os.path.join(ROOT, "eval", "golden.provisional.jsonl")
# 判定"命中"用的 k。取 5 是因为线上 `searchChunks(question, 5)` 把 5 条全拼进 prompt ——
# 第 6 名之后的片段根本没进模型眼前，算不算"检索到了"对产品没有意义。
K = 5


def metrics_at(records: list[dict], depth: int) -> dict:
    first_ranks = []
    for r in records:
        # top_k = depth：要看到完整的融合列表才知道 gold 的真实位次
        res = search_chunks(r["question"], depth, mode="hybrid", candidates=depth)
        if res.get("error"):
            sys.exit(f"[sweep] 检索报错：{res['error']}")
        ranked = [h["id"] for h in res["results"]]
        gold = set(r["gold_chunk_ids"])
        first_ranks.append(next((i + 1 for i, cid in enumerate(ranked) if cid in gold), None))

    n = len(first_ranks)
    return {
        "pool_depth": depth,
        "n": n,
        f"recall@{K}": sum(1 for x in first_ranks if x and x <= K) / n,
        f"mrr@{K}": sum(1 / x for x in first_ranks if x and x <= K) / n,
        "top1_share": sum(1 for x in first_ranks if x == 1) / n,
        f"rank2_{K}_share": sum(1 for x in first_ranks if x and 2 <= x <= K) / n,
        "misses": sum(1 for x in first_ranks if x is None),
        "in_pool_share": sum(1 for x in first_ranks if x is not None) / n,
        "first_ranks": first_ranks,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="RRF 融合池深度扫描")
    ap.add_argument("--golden", default=DEFAULT_GOLDEN)
    ap.add_argument("--depths", default="20,50,100,200")
    ap.add_argument("--out", default=os.path.join(REPO_ROOT, "eval-reports", "pool-sweep.json"))
    args = ap.parse_args()

    depths = [int(d) for d in args.depths.split(",")]
    with open(args.golden, encoding="utf-8") as f:
        records = [r for r in (json.loads(line) for line in f if line.strip()) if r.get("gold_chunk_ids")]

    print(f"[sweep] {len(records)} 条，hybrid 融合池深度扫描（命中判据 top-{K}）\n")
    rows = [metrics_at(records, d) for d in depths]

    header = f"{'池深':>6} {'recall@5':>9} {'MRR@5':>7} {'top-1':>7} {'2-5位':>7} {'未命中':>7} {'池内含gold':>10}"
    print(header)
    print("-" * len(header))
    for r in rows:
        print(
            f"{r['pool_depth']:>6} {r[f'recall@{K}']:>9.3f} {r[f'mrr@{K}']:>7.3f} {r['top1_share']:>7.3f}"
            f" {r[f'rank2_{K}_share']:>7.3f} {r['misses']:>7} {r['in_pool_share']:>10.3f}"
        )

    base = rows[0]["first_ranks"]
    print()
    for r in rows[1:]:
        changed = [
            (rec["id"], a, b) for rec, a, b in zip(records, base, r["first_ranks"]) if a != b
        ]
        print(f"  池深 {r['pool_depth']} vs {rows[0]['pool_depth']}：{len(changed)} 条位次不同")
        for cid, a, b in changed:
            print(f"    {cid:14s} {str(a):>5s} → {str(b):>5s}")

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
                "golden": os.path.relpath(args.golden, REPO_ROOT),
                "mode": "hybrid",
                "hit_k": K,
                "median_latency_note": "本脚本只量质量，不量耗时；耗时见 run_retrieval_eval.py 的报告",
                "rows": rows,
            },
            f, ensure_ascii=False, indent=2,
        )
    print(f"\n[sweep] 报告已写入 {os.path.relpath(args.out, REPO_ROOT)}")


if __name__ == "__main__":
    main()

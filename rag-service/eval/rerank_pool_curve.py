"""rerank 池深 ↔ 质量/成本曲线。

rerank 的池深是这轮唯一一个「质量换延迟」的旋钮：质量随池深上升（更多候选有机会被提上来），
CPU 成本线性上涨。这个脚本把两者放在一张表上，好判断有没有一个比"全池 20 条"更划算的点。

**一次重排就能算出所有更浅的池**：cross-encoder 给 (query, doc) 打的分与池深无关，
所以池深 N 的结果列表 = 融合结果前 N 条按分重排 + 第 N 条之后的原样接回。
只要 N ≥ 5，它的 top-5 就等于「融合结果前 N 条里分数最高的 5 条」。
所以下面每个 N 的质量都是**精确值**，不是外推；只有耗时是按条数线性估的（表里标明）。

  .venv/Scripts/python eval/rerank_pool_curve.py
  .venv/Scripts/python eval/rerank_pool_curve.py --depths 5,10,15,20 --pool 20
"""
import argparse
import datetime
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import rerank  # noqa: E402
from server import RERANK_FUSION_DEPTH, search_chunks  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(ROOT)
DEFAULT_GOLDEN = os.path.join(ROOT, "eval", "golden.provisional.jsonl")
BASE_MODE = "hybrid"
K = 5


def main() -> None:
    ap = argparse.ArgumentParser(description="rerank 池深曲线")
    ap.add_argument("--golden", default=DEFAULT_GOLDEN)
    ap.add_argument("--pool", type=int, default=20, help="实际重排的条数（要覆盖所有待比较的池深）")
    ap.add_argument("--depths", default="5,10,15,20")
    ap.add_argument("--out", default=os.path.join(REPO_ROOT, "eval-reports", "rerank-pool-curve.json"))
    args = ap.parse_args()

    depths = [int(d) for d in args.depths.split(",")]
    if max(depths) > args.pool:
        sys.exit(f"[curve] 最大池深 {max(depths)} 超过实际重排条数 {args.pool}，模拟不出那个深度的精确值")

    with open(args.golden, encoding="utf-8") as f:
        records = [r for r in (json.loads(line) for line in f if line.strip()) if r.get("gold_chunk_ids")]

    # 每条 query：拿融合结果前 pool 条 → 重排一次 → 记住分数顺序
    per_query = []  # [(gold_ids, fused_ids[:pool], 按分降序的池内下标, rerank_ms)]
    times = []
    for rec in records:
        # candidates 显式给成 rerank 模式实际用的融合深度，否则量的是另一套配置
        fused = search_chunks(rec["question"], args.pool, mode=BASE_MODE, candidates=RERANK_FUSION_DEPTH)
        if fused.get("error"):
            sys.exit(f"[curve] 检索报错：{fused['error']}")
        ids = [h["id"] for h in fused["results"]]
        docs = [h["text"] for h in fused["results"]]

        t0 = time.perf_counter()
        scores = rerank.rerank_scores(rec["question"], docs)
        times.append((time.perf_counter() - t0) * 1000)

        order = sorted(range(len(ids)), key=lambda i: -scores[i])
        per_query.append((set(rec["gold_chunk_ids"]), ids, order))
        print(f"[curve] {rec['id']:14s} pool={args.pool}  {times[-1]:6.0f} ms", flush=True)

    ms_per_doc = statistics.median(times) / args.pool
    print(f"\n[curve] 重排 {args.pool} 条中位 {statistics.median(times):.0f} ms → {ms_per_doc:.1f} ms/条\n")

    rows = []
    header = f"{'池深':>5} {'recall@5':>9} {'MRR@5':>7} {'top-1':>7} {'2-5位':>7} {'未命中':>6} {'重排耗时(估)':>12}"
    print(header)
    print("-" * len(header))
    for n in depths:
        first_ranks = []
        for gold, ids, order in per_query:
            # 池深 n 的结果列表 = 前 n 条按分重排 + 其余原样
            ranked = [ids[i] for i in order if i < n] + ids[n:]
            first_ranks.append(next((j + 1 for j, cid in enumerate(ranked) if cid in gold), None))

        total = len(first_ranks)
        row = {
            "pool_depth": n,
            "n": total,
            f"recall@{K}": sum(1 for x in first_ranks if x and x <= K) / total,
            f"mrr@{K}": sum(1 / x for x in first_ranks if x and x <= K) / total,
            "top1_share": sum(1 for x in first_ranks if x == 1) / total,
            f"rank2_{K}_share": sum(1 for x in first_ranks if x and 2 <= x <= K) / total,
            "misses": sum(1 for x in first_ranks if x is None),
            "rerank_ms_estimated": round(ms_per_doc * n, 1),
            "rerank_ms_note": "按条数线性估的；其余指标是精确值",
        }
        rows.append(row)
        print(
            f"{n:>5} {row[f'recall@{K}']:>9.3f} {row[f'mrr@{K}']:>7.3f} {row['top1_share']:>7.3f}"
            f" {row[f'rank2_{K}_share']:>7.3f} {row['misses']:>6} {row['rerank_ms_estimated']:>10.0f} ms"
        )

    # 以最深的池为基准，看每一档"多花的毫秒"买到了多少 top-1
    deepest = rows[-1]
    print(f"\n  以池深 {deepest['pool_depth']} 为基准，缩到更浅的池省下多少 / 损失多少：")
    for r in rows[:-1]:
        saved = deepest["rerank_ms_estimated"] - r["rerank_ms_estimated"]
        lost = deepest["top1_share"] - r["top1_share"]
        print(
            f"    池深 {r['pool_depth']:>2}：省 {saved:>6.0f} ms（省 {saved / deepest['rerank_ms_estimated']:.0%}）"
            f"  top-1 损失 {lost * 100:>5.1f}pp"
        )

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
                "golden": os.path.relpath(args.golden, REPO_ROOT),
                "base_mode": BASE_MODE,
                "measured_pool": args.pool,
                "hit_k": K,
                "rerank_ms_per_doc": round(ms_per_doc, 1),
                "rows": rows,
            },
            f, ensure_ascii=False, indent=2,
        )
    print(f"\n[curve] 报告已写入 {os.path.relpath(args.out, REPO_ROOT)}")


if __name__ == "__main__":
    main()

"""检索侧评测：对 golden set 逐条跑召回，算 recall@k / hit@k / MRR。

用法：
  .venv/Scripts/python eval/run_retrieval_eval.py
  .venv/Scripts/python eval/run_retrieval_eval.py --golden eval/golden.provisional.jsonl
  .venv/Scripts/python eval/run_retrieval_eval.py --out /tmp/report.json

不调任何 LLM：只做本地 embedding + 点积，零成本、可反复跑、可进 CI。
检索直接调 server.search_chunks，与线上 /search 是同一份实现 —— 否则测的不是真实链路。
报告默认写到仓库根的 eval-reports/<日期>-<prompt 版本>-retrieval.json，按 prompt 版本归档。
"""
import argparse
import datetime
import json
import os
import re
import sqlite3
import statistics
import sys
import time

# 让从仓库根目录调用时也能 import server / embedding
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import DB_PATH, search_chunks  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # rag-service/
REPO_ROOT = os.path.dirname(ROOT)
DEFAULT_GOLDEN = os.path.join(ROOT, "eval", "golden.jsonl")
KS = (1, 3, 5)

PROMPTS_TS = os.path.join(REPO_ROOT, "src", "lib", "ai", "prompts.ts")
RAG_VERSION_RE = re.compile(r'RAG_PROMPT_VERSION\s*=\s*"([^"]+)"')


def rag_prompt_version() -> str:
    """从 prompts.ts 读 `RAG_PROMPT_VERSION`，用于报告归档命名。

    版本号只能有一处定义 —— 在这儿再抄一份字符串，改了 prompts.ts 忘了改这里，
    跨版本对比就会静默失效，而「能跨版本对比」正是这套报告存在的理由。
    """
    try:
        with open(PROMPTS_TS, encoding="utf-8") as f:
            m = RAG_VERSION_RE.search(f.read())
            if m:
                return m.group(1)
    except OSError:
        pass
    return "unknown"


def default_report_path(version: str) -> str:
    """eval-reports/<日期>-<prompt 版本>-retrieval.json，与 TS 侧的 -answer.json 并列。"""
    day = datetime.date.today().isoformat()
    return os.path.join(REPO_ROOT, "eval-reports", f"{day}-{version}-retrieval.json")


def load_golden(path: str) -> list[dict]:
    if not os.path.exists(path):
        sys.exit(f"[eval] 找不到 {path}")
    with open(path, encoding="utf-8") as f:
        records = [json.loads(line) for line in f if line.strip()]
    if not records:
        sys.exit(
            f"[eval] {path} 是空的。先跑 build_golden.py 生成候选，"
            "人工校验后写入 golden.jsonl 再评测（见 eval/golden.schema.md）"
        )
    return records


def load_chunk_sources() -> dict[int, str]:
    """golden 记录里不存 source —— 按 schema 由 gold_chunk_ids 反查，避免同一事实存两份而漂移。"""
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    rows = conn.execute("SELECT id, source FROM chunks").fetchall()
    conn.close()
    return dict(rows)


def evaluate(records: list[dict]) -> tuple[list[dict], list[dict], list[float]]:
    """逐条检索并记录 gold 的排名。gold_chunk_ids 为空的条目不参与召回指标。"""
    answerable = [r for r in records if r.get("gold_chunk_ids")]
    rows, misses, latencies = [], [], []
    source_of = load_chunk_sources()

    for r in answerable:
        started = time.perf_counter()
        res = search_chunks(r["question"], max(KS))
        latencies.append((time.perf_counter() - started) * 1000)

        if res.get("error"):
            sys.exit(f"[eval] 检索链路报错，评测中止：{res['error']}")

        ranked = [hit["id"] for hit in res["results"]]
        gold = set(r["gold_chunk_ids"])
        ranks = [i + 1 for i, cid in enumerate(ranked) if cid in gold]
        first = min(ranks) if ranks else None

        rows.append(
            {
                "id": r["id"],
                "question": r["question"],
                "category": r.get("category", "?"),
                "source": source_of.get(min(gold), "?"),
                "gold": sorted(gold),
                "ranked": ranked,
                "first_rank": first,
                "top1_score": res["results"][0]["score"] if res["results"] else None,
            }
        )
        if first is None:
            misses.append(r)
    return rows, misses, latencies


def summarize(rows: list[dict], latencies: list[float], n_total: int, n_skipped: int) -> dict:
    n = len(rows)
    metrics: dict = {}

    for k in KS:
        # recall@k：该条检索到的 gold 占其全部 gold 的比例，再按条取平均
        metrics[f"recall@{k}"] = sum(
            len(set(row["ranked"][:k]) & set(row["gold"])) / len(row["gold"]) for row in rows
        ) / n
        # hit@k：至少命中一个 gold 的条目比例
        metrics[f"hit@{k}"] = sum(
            1 for row in rows if row["first_rank"] and row["first_rank"] <= k
        ) / n

    # MRR@5：首个命中排名的倒数均值，未命中记 0
    metrics["mrr@5"] = sum(1 / row["first_rank"] for row in rows if row["first_rank"]) / n
    metrics["misses"] = sum(1 for row in rows if row["first_rank"] is None)
    metrics["n_queries"] = n
    metrics["n_records"] = n_total
    metrics["n_skipped_no_gold"] = n_skipped
    metrics["latency_ms_median"] = statistics.median(latencies) if latencies else None
    metrics["top1_score_mean"] = (
        statistics.mean(row["top1_score"] for row in rows if row["top1_score"] is not None)
        if rows
        else None
    )

    by_category = {}
    for row in rows:
        entry = by_category.setdefault(row["category"], {"n": 0, "recall@5": 0.0, "hit@5": 0})
        entry["n"] += 1
        entry["recall@5"] += len(set(row["ranked"][:5]) & set(row["gold"])) / len(row["gold"])
        entry["hit@5"] += 1 if row["first_rank"] and row["first_rank"] <= 5 else 0
    for entry in by_category.values():
        entry["recall@5"] /= entry["n"]
        entry["hit@5"] /= entry["n"]

    return {"metrics": metrics, "by_category": by_category}


def main():
    ap = argparse.ArgumentParser(description="RAG 检索侧评测（recall@k / hit@k / MRR）")
    ap.add_argument("--golden", default=DEFAULT_GOLDEN, help="golden set 路径")
    ap.add_argument("--out", default=None, help="报告输出路径（默认 eval-reports/<日期>-<prompt 版本>-retrieval.json）")
    ap.add_argument("--prompt-version", default=None, help="归档用版本号；默认从 src/lib/ai/prompts.ts 读")
    ap.add_argument("--show-misses", type=int, default=10, help="打印前 N 条未命中")
    args = ap.parse_args()

    version = args.prompt_version or rag_prompt_version()
    out = args.out or default_report_path(version)

    records = load_golden(args.golden)
    gold_sizes = {len(r.get("gold_chunk_ids", [])) for r in records if r.get("gold_chunk_ids")}

    rows, misses, latencies = evaluate(records)
    report = summarize(rows, latencies, len(records), len(records) - len(rows))
    metrics = report["metrics"]

    print(f"[eval] golden: {args.golden}")
    print(f"[eval] prompt 版本: rag {version}")
    print(f"[eval] 记录 {metrics['n_records']} 条，参与召回 {metrics['n_queries']} 条"
          f"（跳过 gold 为空的 {metrics['n_skipped_no_gold']} 条）")
    if gold_sizes == {1}:
        print("[eval] 每条 gold 均为 1 个片段 → 本集合上 recall@k 与 hit@k 恒等；"
              "多 gold 的 multi_hop 题才会分叉")
    else:
        print(f"[eval] 每条 gold 片段数分布: {sorted(gold_sizes)}")

    print("\n[eval] 指标")
    for k in KS:
        print(f"  recall@{k}  {metrics[f'recall@{k}']:.3f}")
    for k in KS:
        print(f"  hit@{k}     {metrics[f'hit@{k}']:.3f}")
    print(f"  MRR@5     {metrics['mrr@5']:.3f}")
    print(f"  完全未命中 {metrics['misses']} / {metrics['n_queries']}")
    print(f"  单次检索中位耗时 {metrics['latency_ms_median']:.0f} ms"
          f"，top-1 相似度均值 {metrics['top1_score_mean']:.3f}")

    print("\n[eval] 按 category（recall@5）")
    for cat, entry in sorted(report["by_category"].items(), key=lambda kv: -kv[1]["n"]):
        print(f"  {cat:12s} n={entry['n']:3d}  recall@5 {entry['recall@5']:.3f}  hit@5 {entry['hit@5']:.3f}")

    if misses and args.show_misses:
        print(f"\n[eval] 未命中前 {min(args.show_misses, len(misses))} 条")
        for r in misses[: args.show_misses]:
            print(f"  {r['id']} gold={r['gold_chunk_ids']}  {r['question']}")

    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    payload = {
        "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
        "golden": os.path.relpath(args.golden, REPO_ROOT),
        # 与 scripts/eval-answer.ts 的报告同名字段，方便两份报告并排比较
        "prompt_versions": {"rag": version},
        **report,
        "misses": [
            {"id": r["id"], "question": r["question"], "gold": r["gold_chunk_ids"]}
            for r in misses
        ],
        "rows": rows,
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"\n[eval] 报告已写入 {os.path.relpath(out, REPO_ROOT)}")


if __name__ == "__main__":
    main()

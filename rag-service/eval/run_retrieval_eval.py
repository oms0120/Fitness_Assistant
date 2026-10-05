"""检索侧评测：对 golden set 逐条跑召回，算 recall@k / hit@k / MRR。

用法：
  .venv/Scripts/python eval/run_retrieval_eval.py
  .venv/Scripts/python eval/run_retrieval_eval.py --golden eval/golden.provisional.jsonl
  .venv/Scripts/python eval/run_retrieval_eval.py --compare          # dense vs hybrid 并排
  .venv/Scripts/python eval/run_retrieval_eval.py --mode hybrid

不调任何 LLM：只做本地 embedding + 点积 / BM25，零成本、可反复跑、可进 CI。
检索直接调 server.search_chunks，与线上 /search 是同一份实现 —— 否则测的不是真实链路。
报告默认写到仓库根的 eval-reports/<日期>-<prompt 版本>-<模式>-retrieval.json。
**文件名带模式**：dense 和 hybrid 的数是两回事，共用文件名会静默覆盖。
"""
import argparse
import datetime
import itertools
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
# k 一路取到 100：**曲线形状**才决定瓶颈在召回还是排序 ——
# 尾部还在爬 = 正确片段压根没进候选池（改召回）；很快到 1.000 = 只是前几位排错了（改 rerank）。
# 只报 k=1/3/5 看不出这个区别，而"召回还是排序"正是这份评测要回答的唯一问题。
# 检索本身不受影响：embedding 是大头，多排序几十条是零头（见 latency_ms_median 的注释）。
KS = (1, 3, 5, 10, 20, 50, 100)
# 全部可选模式。bm25 是 dense 与 hybrid 之间的归因中间点（线上不用，但对照表要它）；
# hybrid+rerank20 的池深写进名字，见 server.py 的 _RERANK_RE 注释。
MODES = ("dense", "bm25", "hybrid", "hybrid+rerank20")

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


def default_report_path(version: str, mode: str) -> str:
    """eval-reports/<日期>-<prompt 版本>-<模式>-retrieval.json，与 TS 侧的 -answer.json 并列。"""
    day = datetime.date.today().isoformat()
    return os.path.join(REPO_ROOT, "eval-reports", f"{day}-{version}-{mode}-retrieval.json")


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


def evaluate(
    records: list[dict], mode: str, candidates: int
) -> tuple[list[dict], list[dict], list[float], list[float]]:
    """逐条检索并记录 gold 的排名。gold_chunk_ids 为空的条目不参与召回指标。

    返回 (rows, misses, 总耗时, 重排耗时)。两个耗时分开收：rerank 的代价必须能和
    embedding 那一次 HTTP 调用区分开，否则"噪声底之上的延迟增量"根本读不出来。
    """
    answerable = [r for r in records if r.get("gold_chunk_ids")]
    rows, misses, latencies, rerank_ms = [], [], [], []
    source_of = load_chunk_sources()

    for r in answerable:
        started = time.perf_counter()
        res = search_chunks(r["question"], max(KS), mode=mode, candidates=candidates)
        latencies.append((time.perf_counter() - started) * 1000)
        rerank_ms.append((res.get("timings") or {}).get("rerank_ms", 0.0))

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
    return rows, misses, latencies, rerank_ms


def summarize(
    rows: list[dict], latencies: list[float], n_total: int, n_skipped: int,
    rerank_ms: list[float] | None = None,
) -> dict:
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

    # MRR@5：首个命中排名的倒数均值，未命中记 0。
    # 必须显式卡 <=5：KS 里现在有 k=100，first_rank 能取到 100，
    # 不卡的话这个数会静默变成 MRR@100（0.687 → 0.702），而名字还写着 @5。
    metrics["mrr@5"] = sum(
        1 / row["first_rank"] for row in rows if row["first_rank"] and row["first_rank"] <= 5
    ) / n
    # 命中者的位次拆成两档。**rerank 的价值全在这两个数上，不在 recall@5 上**：
    # recall@5 把"排第 1"和"排第 5"当成同一件事，而把 gold 从第 4 位提到第 1 位
    # 正是 cross-encoder 最擅长、也最该被看见的动作。只有这两个数能反映它。
    metrics["top1_share"] = sum(1 for row in rows if row["first_rank"] == 1) / n
    metrics["rank2_5_share"] = sum(
        1 for row in rows if row["first_rank"] and 2 <= row["first_rank"] <= 5
    ) / n
    # 未进 top-max(KS)：正确片段根本没被检索出来的条数。这个数接近 0 就说明瓶颈不在召回。
    metrics["misses"] = sum(1 for row in rows if row["first_rank"] is None)
    metrics["n_queries"] = n
    metrics["n_records"] = n_total
    metrics["n_skipped_no_gold"] = n_skipped
    metrics["latency_ms_median"] = statistics.median(latencies) if latencies else None
    # 重排那一段单独报。非 rerank 模式下恒为 0，表里一眼能看出是哪一行在付这个代价。
    metrics["rerank_ms_median"] = statistics.median(rerank_ms) if rerank_ms else 0.0
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


def report_lines(mode: str, report: dict, misses: list[dict]) -> list[str]:
    """单个模式的结果块。返回行列表而不是直接 print，好让 --compare 能把两块攒着一起打。"""
    m = report["metrics"]
    lines = [
        f"\n[eval] {mode}",
        # 曲线打一行：形状（尾部是否还在爬）比单个数字重要，分 7 行反而看不出趋势
        "  recall@k  " + "  ".join(f"k={k}:{m[f'recall@{k}']:.3f}" for k in KS),
        "  hit@k     " + "  ".join(f"k={k}:{m[f'hit@{k}']:.3f}" for k in KS),
        f"  MRR@5     {m['mrr@5']:.3f}   top-1 占比 {m['top1_share']:.3f}   2–5 位占比 {m['rank2_5_share']:.3f}",
        f"  未进 top-{max(KS)}  {m['misses']} / {m['n_queries']}",
        # 耗时按 max(KS) 量的：稠密侧开销几乎全在 embedding 那一次 HTTP 调用上，
        # 点积+排序 1985 条是零点几毫秒。hybrid 多一次 BM25 打分，比 embedding 便宜得多。
        # rerank 那一段单独报 —— 它是唯一会显著推高耗时的环节。
        f"  单次检索中位耗时 {m['latency_ms_median']:.0f} ms（k={max(KS)}，含 embedding）"
        + (f"，其中重排 {m['rerank_ms_median']:.0f} ms" if m.get("rerank_ms_median") else "")
        + f"，top-1 相似度均值 {m['top1_score_mean']:.3f}",
        "\n  按 category（recall@5）",
    ]
    for cat, entry in sorted(report["by_category"].items(), key=lambda kv: -kv[1]["n"]):
        lines.append(f"    {cat:12s} n={entry['n']:3d}  recall@5 {entry['recall@5']:.3f}  hit@5 {entry['hit@5']:.3f}")
    if misses:
        lines.append(f"\n  未命中前 {min(10, len(misses))} 条")
        for r in misses[:10]:
            lines.append(f"    {r['id']} gold={r['gold_chunk_ids']}  {r['question']}")
    return lines


def oracle_analysis(rows_by_mode: dict[str, list[dict]], modes: list[str], k: int = 5) -> list[str]:
    """跨模式的并集分析：融合从每一路拿到了什么、又丢掉了什么。

    这是「融合值不值」的唯一硬证据。单看 hybrid 的 0.909 说明不了问题 —— 得同时知道
    dense 单独能拿多少、BM25 单独能拿多少、**并集**能拿多少。并集与实际之间的差，
    就是 RRF 用"奖励共识"换来的代价：一个只用名次的融合器不可能同时保住两路的第一名。

    返回行列表而不是直接 print，与 report_lines 一致，好让调用方决定怎么排列。
    """
    hit = {
        m: {r["id"]: bool(r["first_rank"] and r["first_rank"] <= k) for r in rows_by_mode[m]}
        for m in modes
    }
    ids = [r["id"] for r in rows_by_mode[modes[0]]]
    n = len(ids)
    union = {i: any(hit[m][i] for m in modes) for i in ids}

    lines = [f"\n[eval] oracle 并集分析（判据：gold 进 top-{k}）"]
    for m in modes:
        lines.append(f"  {m:20s} 单独命中 {sum(hit[m].values()) / n:.3f}")
    lines.append(f"  {'并集（任一路命中）':20s} {'':9s} {sum(union.values()) / n:.3f}   ← 融合的理论上限")

    if len(modes) >= 2:
        last = modes[-1]
        lines.append(
            f"  {last:20s} 实际      {sum(hit[last].values()) / n:.3f}   ← 融合实际拿到多少"
        )
        lost = [i for i in ids if union[i] and not hit[last][i]]
        if lost:
            lines.append(f"  融合丢了 {len(lost)} 条（并集里有、{last} 的 top-{k} 里没有）：{', '.join(lost)}")

    if len(modes) >= 2:
        lines.append(f"\n  两两列联表（both / 前者独有 / 后者独有 / 都无），判据 top-{k}")
        for a, b in itertools.combinations(modes, 2):
            both = sum(1 for i in ids if hit[a][i] and hit[b][i])
            only_a = sum(1 for i in ids if hit[a][i] and not hit[b][i])
            only_b = sum(1 for i in ids if hit[b][i] and not hit[a][i])
            neither = sum(1 for i in ids if not hit[a][i] and not hit[b][i])
            extra = ""
            if only_a:
                extra += f"   前者独有：{', '.join(i for i in ids if hit[a][i] and not hit[b][i])}"
            lines.append(f"  {a} × {b}:  {both} / {only_a} / {only_b} / {neither}{extra}")
    return lines


def run_mode(mode: str, records: list[dict], candidates: int) -> tuple[dict, list[dict]]:
    rows, misses, latencies, rerank_ms = evaluate(records, mode, candidates)
    report = summarize(rows, latencies, len(records), len(records) - len(rows), rerank_ms)
    report["rows"] = rows
    report["misses_detail"] = [
        {"id": r["id"], "question": r["question"], "gold": r["gold_chunk_ids"]} for r in misses
    ]
    return report, misses


def eval_at(records: list[dict], mode: str, top_k: int, candidates: int) -> dict:
    """按**线上配置**量一次（top_k=5、候选池 50），不画曲线。

    为什么要单独量：上面那条曲线是拿 top_k=max(KS) 跑的，而 `search_chunks` 里
    `n = max(candidates, top_k)` —— top_k=100 时 candidates 被 max() 顶掉，形同虚设。
    换句话说，曲线上那个 recall@5 是在 100 深的池子里取的 top-5，而线上是 50 深的池子。
    RRF 的分数来自名次，池子深浅会改变融合结果，这两个数不一定相等 —— 拿池子 100 的
    recall@5 当线上指标，就是在报一个线上拿不到的数。
    """
    answerable = [r for r in records if r.get("gold_chunk_ids")]
    n = len(answerable)
    hits = 0
    mrr = 0.0
    for r in answerable:
        res = search_chunks(r["question"], top_k, mode=mode, candidates=candidates)
        if res.get("error"):
            sys.exit(f"[eval] 检索链路报错，评测中止：{res['error']}")
        ranked = [hit["id"] for hit in res["results"]]
        gold = set(r["gold_chunk_ids"])
        ranks = [i + 1 for i, cid in enumerate(ranked) if cid in gold]
        if ranks:
            hits += 1
            mrr += 1 / min(ranks)
    return {
        "top_k": top_k,
        "candidates_per_route": candidates,
        "n": n,
        f"recall@{top_k}": hits / n if n else 0.0,
        f"hit@{top_k}": hits / n if n else 0.0,
        f"mrr@{top_k}": mrr / n if n else 0.0,
    }


def main():
    ap = argparse.ArgumentParser(description="RAG 检索侧评测（recall@k / hit@k / MRR）")
    ap.add_argument("--golden", default=DEFAULT_GOLDEN, help="golden set 路径")
    ap.add_argument("--mode", default="dense", choices=MODES, help="检索模式（默认 dense）")
    ap.add_argument("--compare", action="store_true", help="dense 与 hybrid 都跑，并排比较")
    ap.add_argument(
        "--candidates",
        type=int,
        default=max(KS),
        help=f"融合前每一路取多少条（默认 {max(KS)}，与最大的 k 对齐 —— 池子比 k 小的话，"
        "recall@k 量的是池子而不是系统）",
    )
    ap.add_argument("--out", default=None, help="报告输出路径（默认 eval-reports/<日期>-<版本>-<模式>-retrieval.json）")
    ap.add_argument("--prompt-version", default=None, help="归档用版本号；默认从 src/lib/ai/prompts.ts 读")
    ap.add_argument("--show-misses", type=int, default=10, help="打印前 N 条未命中")
    ap.add_argument("--prod-top-k", type=int, default=5, help="线上 top_k，用来单独量一组线上配置的数（0 跳过）")
    ap.add_argument("--prod-candidates", type=int, default=50, help="线上候选池，同上")
    args = ap.parse_args()

    if args.compare and args.out:
        sys.exit("[eval] --compare 会写两份报告，不能和 --out 一起用")

    version = args.prompt_version or rag_prompt_version()
    modes = list(MODES) if args.compare else [args.mode]

    records = load_golden(args.golden)
    gold_sizes = {len(r.get("gold_chunk_ids", [])) for r in records if r.get("gold_chunk_ids")}

    print(f"[eval] golden: {args.golden}")
    print(f"[eval] prompt 版本: rag {version}  |  候选池 {args.candidates} / 路")
    print(f"[eval] 记录 {len(records)} 条，参与召回 {sum(1 for r in records if r.get('gold_chunk_ids'))} 条")
    if gold_sizes == {1}:
        print("[eval] 每条 gold 均为 1 个片段 → 本集合上 recall@k 与 hit@k 恒等；"
              "多 gold 的 multi_hop 题才会分叉")
    else:
        print(f"[eval] 每条 gold 片段数分布: {sorted(gold_sizes)}")

    all_metrics = {}
    all_production = {}
    all_rows = {}
    for mode in modes:
        report, misses = run_mode(mode, records, args.candidates)
        all_metrics[mode] = report["metrics"]
        all_rows[mode] = report["rows"]

        for line in report_lines(mode, report, misses if args.show_misses else []):
            print(line)

        production = None
        if args.prod_top_k > 0:
            production = eval_at(records, mode, args.prod_top_k, args.prod_candidates)
            all_production[mode] = production
            k = production["top_k"]
            print(
                f"\n  线上配置（top_k={k}，候选池 {production['candidates_per_route']}/路）"
                f"  recall@{k} {production[f'recall@{k}']:.3f}"
                f"  MRR@{k} {production[f'mrr@{k}']:.3f}"
            )

        out = args.out or default_report_path(version, mode)
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        payload = {
            "generated_at": datetime.datetime.now().isoformat(timespec="seconds"),
            "golden": os.path.relpath(args.golden, REPO_ROOT),
            # 与 scripts/eval-answer.ts 的报告同名字段，方便两份报告并排比较
            "prompt_versions": {"rag": version},
            "retrieval_mode": mode,
            "candidates_per_route": args.candidates,
            # 未命中 = 未进 top-max(KS)，即正确片段压根没被检索出来
            "misses_within_top": max(KS),
            "metrics": report["metrics"],
            "production_config": production,
            "by_category": report["by_category"],
            "misses": report["misses_detail"],
            "rows": report["rows"],
        }
        with open(out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"[eval] 报告已写入 {os.path.relpath(out, REPO_ROOT)}")

    if len(all_metrics) > 1:
        # 差值取**相邻两列**而不是「末项 − 首项」。三种以上模式时，后者会算出 rerank − dense，
        # 而对照表要的是 rerank − hybrid —— 融合的贡献和重排的贡献会糊成一个数。
        print("\n[eval] 并排比较（同一条 golden、同一个候选池；Δ 相邻 = 与本列左边一列之差）")
        print("  " + "指标".ljust(16) + "".join(m.rjust(12) for m in modes))

        def row(label: str, vals: list, fmt: str, delta_fmt: str, unit: str = "") -> None:
            print(f"  {label.ljust(16)}" + "".join(f"{fmt.format(v):>12}" for v in vals) + unit)
            deltas = [None] + [vals[i] - vals[i - 1] for i in range(1, len(vals))]
            body = "".join("—".rjust(12) if d is None else f"{delta_fmt.format(d):>12}" for d in deltas)
            print(f"  {'  Δ 相邻'.ljust(16)}{body}")

        # 每个指标一套格式："misses" 是条数，"latency_ms_median" 是毫秒，其余是比率。
        # 差值要独立一套带正号的格式 —— 不能拿比率格式的结果再套 `>+11`，
        # 那是对字符串用数字的对齐说明符，会抛 "Sign not allowed in string format specifier"。
        metrics_keys = (
            [f"recall@{k}" for k in KS]
            + ["mrr@5", "top1_share", "rank2_5_share", "misses", "latency_ms_median"]
        )
        for key in metrics_keys:
            unit = " ms" if key == "latency_ms_median" else ""
            count = key in ("misses", "latency_ms_median")
            row(
                key,
                [all_metrics[m][key] for m in modes],
                "{:.0f}" if count else "{:.3f}",
                "{:+.0f}" if count else "{:+.3f}",
                unit,
            )

        if len(all_production) > 1:
            prod_k = next(iter(all_production.values()))["top_k"]
            print(f"\n  线上配置（top_k={prod_k}，候选池 {args.prod_candidates}/路）")
            for key in [f"recall@{prod_k}", f"mrr@{prod_k}"]:
                row(key, [all_production[m][key] for m in modes], "{:.3f}", "{:+.3f}")

        for line in oracle_analysis(all_rows, modes, k=args.prod_top_k if args.prod_top_k > 0 else 5):
            print(line)


if __name__ == "__main__":
    main()

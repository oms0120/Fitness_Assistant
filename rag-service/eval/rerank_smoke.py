"""rerank 集成冒烟测试：接进 server.py 之后跑，验证整条链和降级路径。

  .venv/Scripts/python eval/rerank_smoke.py

比"指标有没有涨"更重要的两件事，这里都要当场验：
  1. **分数是不是真的随内容变**。padding / attention_mask 接线错不会报错，只会让所有
     logits 恒等 —— 那种失败在全量指标里只表现为"没有提升"，根本认不出是 bug。
  2. **模型缺失时会不会 500**。软降级是本设计的一部分（见 server.py 的 rerank_error），
     必须能作证，否则部署时第一次踩到就是线上事故。

池深取自模式名（`hybrid+rerank20`），不是 candidates —— 见 server.py 的 _RERANK_RE 注释：
RRF 只看名次，candidates 收到 20 会让 `diet-018` 的 gold 直接掉出融合结果。
"""
import argparse
import json
import os
import statistics
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import rerank  # noqa: E402
from server import search_chunks  # noqa: E402

DEFAULT_GOLDEN = os.path.join(ROOT, "eval", "golden.provisional.jsonl")
# hybrid 下最深的 3 条 miss（baseline-report.md §3），改善才看得见
DEFAULT_IDS = ("diet-018", "strength-025", "diet-034")
RERANK_MODE = "hybrid+rerank20"
POOL = 20


def rank_of(order: list[int], gold: set[int]) -> int | None:
    return next((i for i, cid in enumerate(order, start=1) if cid in gold), None)


def main() -> int:
    ap = argparse.ArgumentParser(description="rerank 集成冒烟测试")
    ap.add_argument("--golden", default=DEFAULT_GOLDEN)
    ap.add_argument("--ids", default=",".join(DEFAULT_IDS))
    ap.add_argument("--pool", type=int, default=POOL)
    args = ap.parse_args()

    failures: list[str] = []

    def check(cond: bool, label: str, detail: str = "") -> None:
        print(f"  [{'OK  ' if cond else 'FAIL'}] {label}{('  ' + detail) if detail else ''}", flush=True)
        if not cond:
            failures.append(label)

    with open(args.golden, encoding="utf-8") as f:
        by_id = {r["id"]: r for r in (json.loads(line) for line in f if line.strip())}
    ids = tuple(args.ids.split(","))

    # ---- 1. 模型文件与图契约 ----
    st = rerank.stats()
    print(f"[smoke] 模型 {st['model_name']} @ {st['model_dir']}")
    check(os.path.exists(os.path.join(st["model_dir"], st["model_file"])), f"{st['model_file']} 存在")

    # ---- 2. 负对照：模型在给 (query, doc) 对打分，不是给 doc 打静态分 ----
    # 同一批文档，换成无关 query 重打一遍。若 pair 编码或 mask 是坏的，两组分数会一样。
    first = by_id[ids[0]]
    other = by_id[ids[1]]
    hybrid = search_chunks(first["question"], args.pool, mode="hybrid")
    docs = [h["text"] for h in hybrid["results"]]
    right = rerank.rerank_scores(first["question"], docs)
    wrong = rerank.rerank_scores(other["question"], docs)
    check(len(right) == args.pool, "分数条数 == 候选条数", f"{len(right)}")
    check(all(0.0 <= s <= 1.0 for s in right), "分数都在 [0,1]（sigmoid 生效）")
    check(statistics.pstdev(right) > 1e-6, "分数有离散度（不是恒定值）", f"pstdev={statistics.pstdev(right):.4f}")
    gold0 = set(first["gold_chunk_ids"])
    gi = next((i for i, h in enumerate(hybrid["results"]) if h["id"] in gold0), None)
    check(
        gi is not None and right[gi] > wrong[gi],
        "负对照：gold 在正确 query 下分更高",
        f"正确 {right[gi]:.4f} > 无关 {wrong[gi]:.4f}" if gi is not None else "（池内无 gold）",
    )

    # ---- 3. 逐条：池内名次 前 → 后 ----
    print(f"\n[smoke] {RERANK_MODE}，池深 {args.pool}\n")
    print(f"  {'id':14s} {'gold':>5s} {'重排前':>6s} {'重排后':>6s}  变化      耗时")
    improved = 0
    for rid in ids:
        rec = by_id[rid]
        before = search_chunks(rec["question"], args.pool, mode="hybrid")
        t0 = time.perf_counter()
        after = search_chunks(rec["question"], args.pool, mode=RERANK_MODE)
        ms = (time.perf_counter() - t0) * 1000
        check(after.get("reranked") is True, f"{rid} reranked 标记为真", after.get("rerank_error", ""))
        check(after.get("rerank_pool") == args.pool, f"{rid} rerank_pool == {args.pool}")

        gold = set(rec["gold_chunk_ids"])
        b = rank_of([h["id"] for h in before["results"]], gold)
        a = rank_of([h["id"] for h in after["results"]], gold)
        improved += 1 if (a and b and a < b) else 0
        print(
            f"  {rid:14s} {sorted(gold)[0]:>5d} {str(b):>6s} {str(a):>6s}"
            f"  {'提升' if a and b and a < b else ('不变' if a == b else '下降'):<6s} {ms:6.0f} ms"
        )

    check(improved > 0, "至少一条 gold 名次被提上来", f"{improved}/{len(ids)} 条")

    # ---- 4. 不变量：模型缺失时软降级，不 500 ----
    # 起一个子进程，把模型目录指到不存在的路径，验证 search_chunks 照常返回结果 + rerank_error
    probe = (
        "import sys, json; sys.path.insert(0, r'%s');"
        "from server import search_chunks;"
        "r = search_chunks('蛋白质', 5, mode='%s');"
        "print(json.dumps({'n': len(r['results']), 'err': r.get('rerank_error'), 'reranked': r.get('reranked')}))"
        % (ROOT, RERANK_MODE)
    )
    env = dict(os.environ, RAG_RERANK_MODEL_DIR=os.path.join(ROOT, "models", "__missing__"))
    proc = subprocess.run(
        [sys.executable, "-c", probe], capture_output=True, text=True, env=env, cwd=ROOT, timeout=600
    )
    ok = proc.returncode == 0
    check(ok, "模型缺失时不抛异常（退出码 0）", (proc.stderr or "").strip().splitlines()[-1] if not ok else "")
    if ok:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
        check(payload["n"] > 0, "模型缺失时仍返回检索结果（降级成功）", f"n={payload['n']}")
        check(bool(payload["err"]), "模型缺失时给出 rerank_error", str(payload["err"])[:70])
        check(payload["reranked"] is False, "模型缺失时 reranked 为假（没假装成功）")

    print()
    if failures:
        print(f"[smoke] 失败 {len(failures)} 项：{failures}")
        return 1
    print("[smoke] 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(main())

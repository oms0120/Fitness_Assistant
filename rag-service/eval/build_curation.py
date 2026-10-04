"""把 golden 候选集导成人工校对清单（markdown）。

用法：
  .venv/Scripts/python eval/build_curation.py
  .venv/Scripts/python eval/build_curation.py --out ../eval-reports/curation-worksheet.md

输出默认落在仓库根 gitignored 的 `eval-reports/` —— 清单里嵌了语料原文，
而语料（`data/*.txt`）本身就不在版本库里，别把它的转录件提交上去。

清单帮你做三件事：
  1. 逐条给出 gold 片段原文 + 模型当初引用的依据原句，供核对「这段真能支撑这个答案吗」
  2. 标出 baseline 里 gold 的排名 —— 未进 top-5 的，要么标注有问题，要么切分把事实切坏了
  3. 列出「疑似同样能答」的片段，供补多 gold —— 这是让 recall 指标可信的主要工作

**候选是按字面/向量找的，是下界不是全集**：没有逐字复述同一句话、但依然能回答问题的
片段，脚本找不出来，只能靠人读；候选池也只取了检索前若干名。别把「清单里没有候选」
当成「gold 只有这一个」。
"""
import argparse
import datetime
import difflib
import json
import os
import re
import sqlite3
import statistics
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server import DB_PATH, search_chunks  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(ROOT)
DEFAULT_GOLDEN = os.path.join(ROOT, "eval", "golden.provisional.jsonl")
CANDIDATES = os.path.join(ROOT, "eval", "golden.candidates.jsonl")
DEFAULT_OUT = os.path.join(REPO_ROOT, "eval-reports", "curation-worksheet.md")

TOP_K = 50          # 候选池：在前 50 里找「另一个也算对的 gold」。池子开大不亏 —— 候选要回答的是
                    # 「语料里有没有别的片段也能答」，这个问题跟排名无关；每条候选都会标出它自己的排名。
EVIDENCE_MIN = 15   # 与依据原句逐字重合到这个长度，就算「这段也含答案原句」
COS_STRONG = 0.88   # 与 gold 片段的余弦阈值。语料冗余，0.85 会捞出 119 个，太吵
COS_MAX = 3         # 每条最多列几个「主题相似」的中候选

BOUNDARY_RE = re.compile(r"^[A-Za-z一-鿿0-9（(“\"]")
SENT_END_RE = re.compile(r"[。！？]")


def norm_ws(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def looks_like_table(chunk: str) -> bool:
    """这段是不是一张被 OCR 拍平的表格。

    别用「文中出现『表 2-18』」当判据 —— 这是本教材，大半页都在引用图表编号，
    那样会命中 54/110，等于没信号。真表格有结构特征：行多、行短、几乎没有句末标点
    （表格单元格不是句子）。在 110 条上这个判据命中 3 条，且认得出已知坏 gold `diet-024`。
    """
    lines = [line.strip() for line in chunk.split("\n") if line.strip()]
    if len(lines) < 6 or len(SENT_END_RE.findall(chunk)) > 2:
        return False
    return statistics.median(len(line) for line in lines) <= 18


def load_jsonl(path: str) -> list[dict]:
    if not os.path.exists(path):
        sys.exit(f"[curation] 找不到 {path}")
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def load_chunks() -> tuple[dict[int, str], dict[int, np.ndarray]]:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    txt = {i: t for i, t in conn.execute("SELECT id, text FROM chunks")}
    emb = {i: np.frombuffer(b, dtype=np.float32) for i, b in conn.execute("SELECT id, embedding FROM chunks")}
    conn.close()
    return txt, emb


def overlap_len(evidence: str, text: str) -> int:
    """依据原句与片段的最长逐字公共子串长度。"""
    e, t = norm_ws(evidence), norm_ws(text)
    if not e or not t:
        return 0
    return difflib.SequenceMatcher(None, e, t, autojunk=False).find_longest_match(0, len(e), 0, len(t)).size


def gold_warnings(chunk: str, gold_rank: int | None, top_k: int) -> list[str]:
    """对 gold 片段本身的体检。都是启发式，只为把人引到该看的条目上。"""
    out = []
    if gold_rank is None:
        out.append(f"gold 未进检索前 {top_k}")
    elif gold_rank > 5:
        out.append(f"gold 排名 {gold_rank}，在 top-5 之外，被 4 个干扰项稀释")
    if looks_like_table(chunk):
        out.append("gold 疑似表格块（行短、无句末标点）—— 表格误读风险，出题与判分都会被带偏，参见 diet-024")
    if not BOUNDARY_RE.match(chunk):
        out.append("gold 不是从句首开始的，滑窗从半句中间切的")
    return out


def rel_posix(path: str, start: str) -> str:
    """仓库内引用一律用正斜杠 —— os.path.relpath 在 Windows 上给反斜杠，写进 markdown 别扭。"""
    return os.path.relpath(path, start).replace(os.sep, "/")


def render_chunk(chunk: str, label: str, indent: str = "") -> list[str]:
    """整段原文按行引用，保留 OCR 的换行 —— 表格片段的换行就是它的结构，合并会读不懂。"""
    lines = [f"{indent}- {label}"]
    lines += [f"{indent}  > {ln}" if ln.strip() else f"{indent}  >" for ln in chunk.split("\n")]
    return lines


def short_tag(warning: str, top_k: int) -> str:
    """概览表里的短标签 —— 告警原文太长，塞进表格会把列撑爆，全文留在逐条明细里。"""
    if "未进" in warning:
        return f"⚠️ gold 未进前 {top_k}"
    if "之外" in warning:
        return "⚠️ gold 排名 >5"
    if "表格" in warning:
        return "📊 疑似表格"
    if "句首" in warning:
        return "✂️ 从句中开始"
    return f"· {warning}"


def main():
    ap = argparse.ArgumentParser(description="导出 golden 人工校对清单")
    ap.add_argument("--golden", default=DEFAULT_GOLDEN)
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--top-k", type=int, default=TOP_K)
    ap.add_argument("--cos", type=float, default=COS_STRONG)
    args = ap.parse_args()

    records = load_jsonl(args.golden)
    evidence = {r["id"]: r.get("evidence", "") for r in load_jsonl(CANDIDATES)}
    txt, emb = load_chunks()

    entries = []
    for r in records:
        gold = [c for c in r["gold_chunk_ids"] if c in txt]
        if not gold:
            print(f"[curation] 跳过 {r['id']}：gold 片段不在当前索引里（vectors.db 版本变了？）")
            continue

        hits = search_chunks(r["question"], args.top_k)["results"]
        ranked = [h["id"] for h in hits]
        gold_set = set(gold)
        rank = next((i + 1 for i, c in enumerate(ranked) if c in gold_set), None)

        gvec = np.mean([emb[c] for c in gold], axis=0)
        norm = float(np.linalg.norm(gvec))
        gvec = gvec / norm if norm else gvec

        ev = evidence.get(r["id"], "")
        strong, similar = [], []
        for i, cid in enumerate(ranked):
            if cid in gold_set or cid not in txt:
                continue
            cand_rank = i + 1  # 候选自己的检索排名：区分「系统已召回的另一 gold」和「系统也漏了的另一 gold」
            ov = overlap_len(ev, txt[cid])
            if ov >= EVIDENCE_MIN:
                strong.append((cid, cand_rank, ov, float(np.dot(gvec, emb[cid]))))
            elif len(similar) < COS_MAX:
                cos = float(np.dot(gvec, emb[cid]))
                if cos >= args.cos:
                    similar.append((cid, cand_rank, cos))

        entries.append(
            {
                "rec": r,
                "gold": gold,
                "rank": rank,
                "warnings": gold_warnings(txt[gold[0]], rank, args.top_k),
                "strong": strong,
                "similar": similar,
            }
        )

    need = [e for e in entries if e["warnings"] or e["strong"] or e["similar"]]

    def priority(e: dict) -> tuple:
        """排序：要动 gold_chunk_ids 的 > 只该复核的；同类按 id，方便对着原文件核。"""
        gold_missed = any(w.startswith("gold 未进") or "top-5 之外" in w for w in e["warnings"])
        return (not e["strong"], not gold_missed, e["rec"]["id"])

    need.sort(key=priority)

    n_strong = sum(1 for e in entries if e["strong"])
    n_sim = sum(1 for e in entries if e["similar"])
    n_bad_rank = sum(1 for e in entries if e["rank"] is None or e["rank"] > 5)
    n_table = sum(1 for e in entries if any("表" in w for w in e["warnings"]))
    n_mid = sum(1 for e in entries if any("句首" in w for w in e["warnings"]))

    L: list[str] = []
    L.append("# golden set 人工校对清单")
    L.append("")
    L.append(f"生成 {datetime.datetime.now().isoformat(timespec='seconds')}　·　来源 `{rel_posix(args.golden, REPO_ROOT)}`　·　共 {len(entries)} 条")
    L.append("")
    L.append("> 本清单与当前 `data/vectors.db` 绑定（1985 片段 / bge-m3 / `CHUNK_SIZE=400` `OVERLAP=50` `MIN_CHUNK=120`）。")
    L.append("> 重跑 `ingest.py` 后 `chunks.id` 全部重排，**这份清单连同所有 `gold_chunk_ids` 一起作废**，必须重新校对 —— 见 `golden.schema.md`。")
    L.append("")
    L.append("## 怎么用")
    L.append("")
    L.append("1. **删** —— 整条站不住的，不要写进 `golden.jsonl`。")
    L.append("2. **补多 gold** —— 把「疑似同样能答」的片段 id 追加进 `gold_chunk_ids`。语料冗余，同一句指导语常在总表页和正文页各出现一次；单 gold 会把「召回了另一个同样能答的片段」记成 miss，指标就失真了。")
    L.append("3. **确认** —— 读 gold 片段原文，确认它真的支撑参考答案。")
    L.append("")
    L.append("写进 `golden.jsonl` 时**只保留 6 个字段**（`id / question / reference_answer / gold_chunk_ids / category / difficulty`）；本清单里的排名、候选、告警都只是校对辅助，不要带过去。")
    L.append("")
    L.append("### 两个提醒")
    L.append("")
    L.append(f"- 候选是**按字面重合 + 向量相似**在检索前 {args.top_k} 内找的，两重意义上都是下界：排名 {args.top_k} 以外的片段不参与筛选；能回答问题但没逐字复述同一句话的片段，脚本也认不出。**清单里没有候选 ≠ gold 只有一个**，还得靠人读。")
    L.append(f"- `golden.candidates.jsonl` 里还有 `strength-017` / `strength-018` 两条**已确认是目录块出的题**，早先在过滤阶段就被剔掉了，不在本清单的 {len(entries)} 条里 —— 别把它们漏进来。")
    L.append("")
    L.append("## 概览")
    L.append("")
    L.append(f"需要看的 **{len(need)}** 条（下面「建议优先处理」逐条列出），其余 {len(entries) - len(need)} 条没有自动告警，在「无自动告警」一节里按顺序列了 id 和问题，快速过一遍即可。")
    L.append("")
    L.append("| 告警 | 条数 | 含义 |")
    L.append("|---|---|---|")
    L.append(f"| 🔴 含答案原句的片段没被标进 gold | {n_strong} | 几乎肯定该补进 `gold_chunk_ids`（在检索前 {args.top_k} 内找的） |")
    L.append(f"| ⚠️ gold 未进检索前 5 | {n_bad_rank} | 标注有问题，或切分把事实切坏了 —— 逐个看 |")
    L.append(f"| 🟡 与 gold 主题高度相似（cos ≥ {args.cos}） | {n_sim} | 需人工判断：是重复内容还是只是同话题 |")
    L.append(f"| 📊 gold 疑似表格块 | {n_table} | OCR 把表格拍平成短行，列会读串行 —— `diet-024` 就是这么错的 |")
    L.append(f"| ✂️ gold 从句中开始 | {n_mid} | 滑窗产物，事实可能跨在两个窗口之间 |")
    L.append("")

    if need:
        L.append("## 建议优先处理")
        L.append("")
        L.append("| id | 题型 | gold 排名 | 告警 |")
        L.append("|---|---|---|---|")
        for e in need:
            tags = []
            if e["strong"]:
                tags.append(f"🔴 {len(e['strong'])} 个候选含答案原句")
            if e["similar"]:
                tags.append(f"🟡 {len(e['similar'])} 个同主题")
            tags += [short_tag(w, args.top_k) for w in e["warnings"]]
            rank = f"{e['rank']}" if e["rank"] else f">{args.top_k}"
            L.append(f"| `{e['rec']['id']}` | {e['rec']['category']}/{e['rec']['difficulty']} | {rank} | {'；'.join(tags)} |")
        L.append("")

    need_ids = {e["rec"]["id"] for e in need}
    clean = [e for e in entries if e["rec"]["id"] not in need_ids]

    L.append("---")
    L.append("")
    if clean:
        L.append(f"## 无自动告警的 {len(clean)} 条")
        L.append("")
        L.append("过一遍就行。**没有告警不等于没问题** —— 这份清单只覆盖四类机器能认出的毛病（gold 排名低、有雷同片段、疑似表格、从句中起头），标注本身对不对、问题问得好不好，机器判断不了。")
        L.append("")
        L.append("| id | 题型 | 问题 |")
        L.append("|---|---|---|")
        for e in clean:
            r = e["rec"]
            L.append(f"| `{r['id']}` | {r['category']}/{r['difficulty']} | {r['question']} |")
        L.append("")

    L.append("---")
    L.append("")
    L.append("## 逐条明细")
    L.append("")
    L.append("按「要不要动 `gold_chunk_ids`」排序：需要补候选的排在前，然后才是只该复核的。")
    for e in entries:
        r = e["rec"]
        rank = f"检索第 {e['rank']} 位" if e["rank"] else f"未进前 {args.top_k}"
        L.append(f"### `{r['id']}` · {r['category']} / {r['difficulty']} · {rank}")
        L.append("")
        L.append(f"**问**　{r['question']}")
        L.append("")
        L.append(f"**参考答案**　{r['reference_answer']}")
        L.append("")
        if evidence.get(r["id"]):
            L.append(f"**模型当初引用的原句**　{evidence[r['id']]}")
            L.append("")
        for i, cid in enumerate(e["gold"]):
            L += render_chunk(txt[cid], f"gold #{cid}（{len(txt[cid])} 字）")
            if i == 0:
                for w in e["warnings"]:
                    L.append(f"  - ⚠️ {w}")
        L.append("")

        if e["strong"]:
            L.append("**🔴 疑似同样能答 —— 含答案原句逐字片段**")
            L.append("")
            for cid, cand_rank, ov, cos in e["strong"]:
                L.append(f"- `#{cid}`（检索第 {cand_rank} 位）　逐字重合 {ov} 字，与 gold 余弦 {cos:.3f}")
                L.append(f"  > {txt[cid][:160].replace(chr(10), ' / ')}")
            L.append("")
        if e["similar"]:
            L.append(f"**🟡 与 gold 主题高度相似（cos ≥ {args.cos}）—— 需人工判断**")
            L.append("")
            for cid, cand_rank, cos in e["similar"]:
                L.append(f"- `#{cid}`（检索第 {cand_rank} 位）　cos {cos:.3f}")
                L.append(f"  > {txt[cid][:160].replace(chr(10), ' / ')}")
            L.append("")

        if e["strong"]:
            ids = e["gold"] + [c for c, _, _, _ in e["strong"]]
            L.append(f"→ 若确认，`gold_chunk_ids`: `{e['gold']}` → `{ids}`")
            L.append("")
        L.append("")

    os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(L))

    print(f"[curation] {len(entries)} 条，需处理 {len(need)} 条")
    print(f"[curation] 强候选 {n_strong} 条 / gold 排名超 5 的 {n_bad_rank} 条 / 表格告警 {n_table} 条")
    print(f"[curation] 清单已写入 {os.path.relpath(args.out, REPO_ROOT)}")


if __name__ == "__main__":
    main()

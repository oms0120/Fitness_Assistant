"""从已入库的 chunks 反向生成候选 QA，写入 eval/golden.candidates.jsonl。

用法：
  .venv/Scripts/python eval/build_golden.py --dry-run        # 只看抽样，不调 API
  .venv/Scripts/python eval/build_golden.py                  # 默认目标 110 条
  .venv/Scripts/python eval/build_golden.py --target 150 --per-chunk 3
  .venv/Scripts/python eval/build_golden.py --fresh          # 清空候选文件重跑

前置：
  - data/vectors.db 已由 ingest.py 生成
  - 环境变量 DEEPSEEK_API_KEY（与 Next.js 侧同名，另支持 DEEPSEEK_BASE_URL / DEEPSEEK_MODEL）

产出是**候选**，未经人工校验，不得直接当 golden 用 —— 见 eval/golden.schema.md。
每条在 golden 六字段外多带 source / evidence 两个溯源字段，供人工校验时核对；
校验通过、写进 golden.jsonl 时应剥掉这两个字段。
"""
import argparse
import json
import os
import random
import re
import sqlite3
import sys
import time

import requests

# 以脚本所在目录的上级（rag-service/）为根，这样从仓库根目录调用也能 import ingest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ingest import CHUNK_SIZE  # noqa: E402  与切分参数保持同源

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO_ROOT = os.path.dirname(ROOT)
DB_PATH = os.path.join(ROOT, "data", "vectors.db")
OUT_PATH = os.path.join(ROOT, "eval", "golden.candidates.jsonl")


def load_dotenv(path: str) -> None:
    """从仓库根的 .env 兜底读密钥 —— 项目其他配置都在那里，省得每次手动 export。

    用 setdefault，已 export 的真实环境变量优先，不会被文件覆盖。
    """
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_dotenv(os.path.join(REPO_ROOT, ".env"))

API_BASE = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
API_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-chat")

CATEGORIES = ("factual", "numeric", "procedural", "comparative")
DIFFICULTIES = ("easy", "medium", "hard")

# source → golden id 前缀。新增语料时在这里登记，未登记的退化为 ascii 化后的文件名
SOURCE_SLUG = {"dietary_guide": "diet", "力量训练基础": "strength"}

# 片段以这些字符开头才算"从边界开始"，否则是滑窗从半句话中间切的
BOUNDARY_RE = re.compile(r"^[A-Za-z一-鿿0-9（(“\"]")
CJK_RE = re.compile(r"[一-鿿]")

# 目录页与小标题里常见的指代词。问题里出现它们，通常说明这段是目录而非正文
META_RE = re.compile(r"这段|该片段|上述|上文|文中|书中|书里|文档中|本段|该文档")

SYSTEM = (
    "你是健身与营养领域的评测集标注员。用户会给你一段来自专业文档的片段，"
    "你据此出题，用于评测检索系统的召回质量。"
)

USER_TMPL = """【来源】{source}
【片段】
{text}

请据此出 {n} 道题。硬性要求：

1. 问题用**普通用户的口吻**自然提问，不要出现"这段""上述片段""文档中"之类的元指代；
2. 参考答案必须能**完全由上面片段本身**支撑。片段没写的内容一律不准补，宁可不问；
3. 每道题额外给出一段 `evidence`：**逐字复制**片段中支撑该答案的原句（不得改写、不得拼接）；
4. `category` 从 factual（单点事实）/ numeric（数值剂量）/ procedural（怎么做）/ comparative（对比取舍）中选一个；
5. `difficulty` 从 easy / medium / hard 中选一个；
6. 片段内容不足以出站得住的题，就在 `skipped` 里写一句原因，不要硬编。

只输出 JSON，格式：
{{"items":[{{"question":"...","reference_answer":"...","evidence":"...","category":"factual","difficulty":"easy"}}],"skipped":["..."]}}"""


def slug_of(source: str) -> str:
    if source in SOURCE_SLUG:
        return SOURCE_SLUG[source]
    ascii_slug = re.sub(r"[^a-z0-9]+", "", source.lower())
    return ascii_slug or "src"


def norm_ws(s: str) -> str:
    """去掉全部空白后比较，避免模型复制原句时增删空格/换行导致误判。"""
    return re.sub(r"\s+", "", s)


def load_pool(db_path: str) -> list[tuple[int, str, str]]:
    if not os.path.exists(db_path):
        sys.exit(f"[build] 找不到 {db_path}，请先运行 ingest.py")
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    rows = conn.execute("SELECT id, text, source FROM chunks").fetchall()
    conn.close()
    if not rows:
        sys.exit("[build] chunks 表为空，请先运行 ingest.py")
    return rows


def filter_pool(rows, min_chars: int) -> list[tuple[int, str, str]]:
    """留下适合出题的片段：够长、从边界开始、中文占比够、不在结尾被硬截断得离谱。"""
    kept = []
    for cid, text, source in rows:
        text = (text or "").strip()
        if len(text) < min_chars:
            continue
        if not BOUNDARY_RE.match(text):
            continue
        if len(CJK_RE.findall(text)) < min_chars // 4:
            continue
        kept.append((cid, text, source))
    return kept


def interleave(groups: list[list]) -> list:
    """各 source 轮流取，保证抽样覆盖每份语料，而不是被大文件刷屏。"""
    out = []
    for i in range(max((len(g) for g in groups), default=0)):
        for g in groups:
            if i < len(g):
                out.append(g[i])
    return out


def sample_chunks(pool, rng: random.Random) -> list[tuple[int, str, str]]:
    by_source: dict[str, list] = {}
    for row in pool:
        by_source.setdefault(row[2], []).append(row)
    for group in by_source.values():
        rng.shuffle(group)
    return interleave(list(by_source.values()))


def call_deepseek(system: str, user: str, retries: int = 3) -> dict:
    """5xx / 429 / 网络错误退避重试；4xx 立即失败——重试不会让参数错误变对。"""
    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        sys.exit("[build] 未设置 DEEPSEEK_API_KEY")

    last_err = ""
    for attempt in range(retries):
        try:
            res = requests.post(
                f"{API_BASE}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
                json={
                    "model": API_MODEL,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": user},
                    ],
                    "max_tokens": 2048,
                    "response_format": {"type": "json_object"},
                    "stream": False,
                },
                timeout=90,
            )
        except requests.RequestException as exc:
            last_err = str(exc)
        else:
            if res.status_code in (429, 500, 502, 503, 504):
                last_err = f"HTTP {res.status_code}"
            elif not res.ok:
                raise RuntimeError(f"DeepSeek {res.status_code}: {res.text[:200]}")
            else:
                content = res.json()["choices"][0]["message"]["content"]
                return json.loads(content)
        if attempt < retries - 1:
            time.sleep(2**attempt)
    raise RuntimeError(f"DeepSeek 调用失败（{retries} 次）: {last_err}")


def validate(item: dict, chunk_text: str) -> tuple[dict | None, str]:
    """结构 + 溯源自检。返回 (清洗后的条目, 丢弃原因)。"""
    question = (item.get("question") or "").strip()
    answer = (item.get("reference_answer") or "").strip()
    evidence = (item.get("evidence") or "").strip()

    if not question or not answer:
        return None, "缺 question/reference_answer"
    if not evidence:
        return None, "缺 evidence"
    # 模型声称的溯源原句必须真的在片段里 —— 这是最便宜也最硬的防幻觉检查
    if norm_ws(evidence) not in norm_ws(chunk_text):
        return None, "evidence 不在片段中（疑似编造）"
    # 答案只是把问题里的词重说一遍（"有哪些深蹲变式？"→"深蹲变式"），等于没答
    if norm_ws(answer) in norm_ws(question):
        return None, "答案只是复述问题"
    # 问题里带"书里 / 文中 / 上述"这类指代，既违反提示词，也说明该片段是目录或小标题
    if META_RE.search(question):
        return None, "问题含元指代（疑似目录/标题片段）"

    category = item.get("category") if item.get("category") in CATEGORIES else "factual"
    difficulty = item.get("difficulty") if item.get("difficulty") in DIFFICULTIES else "medium"
    return {
        "question": question,
        "reference_answer": answer,
        "category": category,
        "difficulty": difficulty,
        "evidence": evidence,
    }, ""


def load_existing(path: str) -> tuple[set[int], set[str], dict[str, int]]:
    """已跑过就跳过已覆盖的 chunk，避免重复运行堆出一堆近似重复的候选。"""
    used_chunks: set[int] = set()
    seen_questions: set[str] = set()
    seq: dict[str, int] = {}
    if not os.path.exists(path):
        return used_chunks, seen_questions, seq
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            used_chunks.update(rec.get("gold_chunk_ids", []))
            seen_questions.add(norm_ws(rec.get("question", "")))
            slug, _, num = rec.get("id", "").rpartition("-")
            if slug and num.isdigit():
                seq[slug] = max(seq.get(slug, 0), int(num))
    return used_chunks, seen_questions, seq


def main():
    ap = argparse.ArgumentParser(description="从 chunks 反向生成候选 QA")
    ap.add_argument("--target", type=int, default=110, help="目标候选条数（默认 110）")
    ap.add_argument("--per-chunk", type=int, default=2, help="每个片段出几道题（默认 2）")
    ap.add_argument("--min-chars", type=int, default=150, help="片段最短字符数（默认 150）")
    ap.add_argument("--seed", type=int, default=42, help="抽样随机种子（默认 42）")
    ap.add_argument("--out", default=OUT_PATH)
    ap.add_argument("--dry-run", action="store_true", help="只抽样并打印，不调 API")
    ap.add_argument("--fresh", action="store_true", help="忽略已有候选，从零重跑")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    rows = load_pool(DB_PATH)
    pool = filter_pool(rows, args.min_chars)

    print(f"[build] chunks 总数 {len(rows)}，过滤后可用 {len(pool)}")
    by_src: dict[str, int] = {}
    for _, _, src in pool:
        by_src[src] = by_src.get(src, 0) + 1
    for src, n in by_src.items():
        print(f"[build]   {src}: {n}")
    truncated = sum(1 for _, t, _ in pool if len(t) >= CHUNK_SIZE)
    if truncated > len(pool) * 0.8:
        print(
            f"[build] ⚠️ {truncated}/{len(pool)} 个片段长度达到切分上限 {CHUNK_SIZE}，"
            "说明切分基本没按段落生效（滑窗产物会从半句话中间开始）"
        )
    if not pool:
        sys.exit("[build] 没有可用片段，检查 --min-chars 或先修 ingest.py 的切分")

    if args.fresh and os.path.exists(args.out):
        os.remove(args.out)
        print(f"[build] 已清空 {args.out}")
    used_chunks, seen_questions, seq = load_existing(args.out)
    if used_chunks:
        print(f"[build] 已有候选覆盖 {len(used_chunks)} 个片段，将跳过")

    order = sample_chunks(pool, rng)
    if args.dry_run:
        print("\n[build] dry-run 抽样前 5 个：")
        for cid, text, source in order[:5]:
            print(f"  #{cid} [{source}] {text[:70]}...")
        return

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    written = 0
    calls = 0
    dropped: dict[str, int] = {}
    seen_prefix: set[str] = set()

    with open(args.out, "a", encoding="utf-8") as f:
        for cid, text, source in order:
            if written >= args.target:
                break
            if cid in used_chunks:
                continue
            # 50 字重叠会让相邻滑窗高度相似，前缀撞了就跳过，省一次 API 调用
            if norm_ws(text)[:80] in seen_prefix:
                continue

            print(f"[build] #{cid} [{source}] {text[:40]}...", flush=True)
            try:
                data = call_deepseek(
                    SYSTEM,
                    USER_TMPL.format(source=source, text=text, n=args.per_chunk),
                )
            except (RuntimeError, json.JSONDecodeError) as exc:
                why = f"调用失败: {str(exc)[:60]}"
                dropped[why] = dropped.get(why, 0) + 1
                print(f"[build]   调用失败，跳过：{exc}")
                continue
            calls += 1
            seen_prefix.add(norm_ws(text)[:80])

            slug = slug_of(source)
            for item in data.get("items", [])[: args.per_chunk]:
                rec, why = validate(item, text)
                if rec is None:
                    dropped[why] = dropped.get(why, 0) + 1
                    continue
                if norm_ws(rec["question"]) in seen_questions:
                    dropped["问题重复"] = dropped.get("问题重复", 0) + 1
                    continue
                seq[slug] = seq.get(slug, 0) + 1
                seen_questions.add(norm_ws(rec["question"]))
                f.write(
                    json.dumps(
                        {
                            "id": f"{slug}-{seq[slug]:03d}",
                            "question": rec["question"],
                            "reference_answer": rec["reference_answer"],
                            "gold_chunk_ids": [cid],
                            "category": rec["category"],
                            "difficulty": rec["difficulty"],
                            # 以下两个字段仅候选期存在，写进 golden.jsonl 时剥掉
                            "source": source,
                            "evidence": rec["evidence"],
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                )
                f.flush()
                written += 1
            if data.get("skipped"):
                print(f"[build]   模型自述不出的题：{data['skipped']}")

    print(f"\n[build] 新增 {written} 条 → {args.out}（API 调用 {calls} 次）")
    if dropped:
        print("[build] 丢弃统计：")
        for why, n in sorted(dropped.items(), key=lambda kv: -kv[1]):
            print(f"[build]   {why}: {n}")
    total = sum(1 for line in open(args.out, encoding="utf-8") if line.strip())
    print(f"[build] 候选文件现有 {total} 条")


if __name__ == "__main__":
    main()

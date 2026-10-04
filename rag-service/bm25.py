"""BM25 稀疏检索，中文按字符 bigram 切词。

为什么要有它：bge-m3 是 bi-encoder，query 和 chunk 各自编码后才比余弦，没有词面交互。
这对"语义相近但用词不同"是优势，对"必须精确命中某个词"是劣势 —— 而语料里两类查询
都在：`diet-034`「特殊医学用途配方食品…不含乳糖」、`diet-050`「猪肉对膳食脂肪的贡献率」
这种问题，关键词在 gold 片段里是**原样出现**的，只是 bi-encoder 把它们排到了第 9 / 42 位。
BM25 恰好只认词面，与稠密检索互补。

为什么用 bigram 而不是分词：中文没有空格，纯 Python 里做分词要么引 jieba（新依赖），
要么自己写词典。字符 bigram 是零依赖的标准近似，代价是会产生跨词边界的噪声 bigram
（"肉对"、"肪的"），这些靠 IDF 自然压低 —— 它们几乎在所有片段里都出现，权重接近 0。

不用 `rank_bm25` 这类库：核心就两个公式，读得懂的 40 行好过一个需要核对版本行为的依赖。
"""
import math
import re
from collections import Counter, defaultdict

# CJK 统一表意文字 + 扩展 A + 兼容表意文字。够覆盖健康/营养/训练这三类语料。
_CJK = r"㐀-䶿一-鿿豈-﫿"
# 一段连续 CJK 或一段连续字母数字。其余字符（标点、空白、OCR 噪声）当分隔符丢掉。
_RUN_RE = re.compile(rf"[{_CJK}]+|[A-Za-z0-9]+")
_CJK_RE = re.compile(rf"^[{_CJK}]")


def tokenize(text: str) -> list[str]:
    """切词：CJK 连续段 → 字符 bigram；字母数字段 → 整段小写。

    单字 CJK 段（如句末孤立的"盐"）没有 bigram 可取，就保留单字本身。

    字母数字整段保留而不切，是因为语料里的这类串几乎都是整体有意义的东西：
    "2015"、"1.5"、"bge-m3" 拆开就没有意义了。
    """
    tokens: list[str] = []
    for m in _RUN_RE.finditer(text):
        run = m.group()
        if _CJK_RE.match(run):
            if len(run) == 1:
                tokens.append(run)
            else:
                tokens.extend(run[i : i + 2] for i in range(len(run) - 1))
        else:
            tokens.append(run.lower())
    return tokens


class Bm25Index:
    """Okapi BM25（k1=1.5, b=0.75，Lucene 的默认档）。

    在内存里建倒排，不做持久化：1985 个片段建索引约 1 秒，而 `vectors.db` 一换
    （重跑 ingest.py）索引就该重建 —— 存进库里反而要多维护一套失效逻辑。
    server.py 按 `vectors.db` 的 mtime 决定要不要重建。
    """

    K1 = 1.5
    B = 0.75

    def __init__(self, docs: list[tuple[int, str]]):
        self.n = len(docs)
        self.ids: list[int] = []
        self.postings: dict[str, list[tuple[int, int]]] = defaultdict(list)
        self.doc_len: list[int] = []
        total_len = 0

        for idx, (doc_id, text) in enumerate(docs):
            tokens = tokenize(text)
            self.ids.append(doc_id)
            self.doc_len.append(len(tokens))
            total_len += len(tokens)
            for term, tf in Counter(tokens).items():
                self.postings[term].append((idx, tf))

        self.avgdl = total_len / self.n if self.n else 0.0
        # 概率型 IDF，加 1 保证非负：某个词出现在过半文档里时，原始 Robertson-Sparck Jones
        # 公式会给出负数，把总分往下拽。这里语料小、重复段落多，那种词不少。
        self.idf = {
            term: math.log(1 + (self.n - len(posting) + 0.5) / (len(posting) + 0.5))
            for term, posting in self.postings.items()
        }

    def search(self, query: str, top_k: int) -> list[tuple[int, float]]:
        """返回 [(chunk_id, score)]，按分降序。查不到的词直接跳过，不惩罚。"""
        if not self.n or top_k <= 0:
            return []

        # 查询词去重：bigram 让短问句里也会出现重复项（"膳食脂肪" → 膳食/食脂/脂肪，
        # 与后半句的"脂肪"重叠），按标准 BM25 乘 qtf 会让重复的词主导打分。
        scores: dict[int, float] = defaultdict(float)
        for term in set(tokenize(query)):
            posting = self.postings.get(term)
            if not posting:
                continue
            idf = self.idf[term]
            for idx, tf in posting:
                dl = self.doc_len[idx]
                norm = 1 - self.B + self.B * dl / self.avgdl
                scores[idx] += idf * (tf * (self.K1 + 1)) / (tf + self.K1 * norm)

        ranked = sorted(scores.items(), key=lambda kv: -kv[1])[:top_k]
        return [(self.ids[idx], score) for idx, score in ranked]

    def stats(self) -> dict:
        return {
            "docs": self.n,
            "terms": len(self.postings),
            "avgdl": round(self.avgdl, 1),
        }

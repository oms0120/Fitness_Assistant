"""语料切块 + embedding + 入库（一次性脚本）。embedding 由本地 Ollama 的 bge-m3 提供（批量）。

用法：
  .venv/Scripts/python ingest.py

读取 data/*.txt，切块后批量 embedding 存 data/vectors.db（会重建表）。
"""
import os
import re
import sqlite3
import sys

import numpy as np

from embedding import EMBED_MODEL, EmbeddingError, embed_batch

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DATA_DIR, "vectors.db")

CHUNK_SIZE = 400
OVERLAP = 50
BATCH_SIZE = 32
MIN_CHUNK = 120  # 段落短于此值先与相邻段落合并，避免目录行/标题各成一个无信息片段


def clean(text: str) -> str:
    """清洗：压缩连续空行、合并行内空白、去空行（OCR 噪声），但保留段落分隔。

    结尾必须按段落重新拼接。早先的实现是 ``"\\n".join(所有非空行)``，
    会把上一行刚压出来的 ``\\n\\n`` 又抹成单换行，于是 chunk_text 里的
    ``text.split("\\n\\n")`` 每份语料只切出 1 个段落，按段落切块彻底失效，
    全文退化成 400/50 滑窗（1739 个片段里只有 3 个短于 400 字符）。
    """
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    paragraphs = []
    for para in text.split("\n\n"):
        lines = [l.strip() for l in para.split("\n")]
        lines = [l for l in lines if l]
        if lines:
            paragraphs.append("\n".join(lines))
    return "\n\n".join(paragraphs)


def merge_short_paragraphs(paragraphs: list[str], min_size: int) -> list[str]:
    """把过短的段落（目录行、小标题、表格残行）粘到相邻段落上。

    切分修好之后这类段落会各自成为一个片段，而它们的向量几乎不携带语义信息，
    却可能挤进 top-k 把真正有内容的片段挤出去。粘合后内容不丢，只是不再单独成段。
    单独一个文件全是短行时（整篇目录），至少留 min_size//5 以免全被丢掉。
    """
    merged: list[str] = []
    buf = ""
    for para in paragraphs:
        buf = f"{buf}\n{para}" if buf else para
        if len(buf) >= min_size:
            merged.append(buf)
            buf = ""
    if buf:
        if merged:
            merged[-1] = f"{merged[-1]}\n{buf}"  # 尾部残段并入上一条，不单列
        elif len(buf) >= min_size // 5:
            merged.append(buf)
    return merged


def chunk_text(
    text: str,
    size: int = CHUNK_SIZE,
    overlap: int = OVERLAP,
    min_size: int = MIN_CHUNK,
) -> list[str]:
    """按段落切块：整段保留；超长段落在段内滑窗。

    尾窗剩余不足两个 overlap 时直接并入当前窗口——早先的写法按固定步长推进，
    L=760 的段落会切出 ``[700:760]`` 这种 60 字的尾巴，既没有语义又占一个向量位。
    """
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []
    for para in merge_short_paragraphs(paragraphs, min_size):
        if len(para) <= size:
            chunks.append(para)
            continue
        start = 0
        while start < len(para):
            end = start + size
            if len(para) - end < overlap * 2:
                end = len(para)
            chunks.append(para[start:end])
            if end >= len(para):
                break
            start += size - overlap
    return chunks


def main():
    os.makedirs(DATA_DIR, exist_ok=True)

    txt_files = [f for f in os.listdir(DATA_DIR) if f.endswith(".txt")]
    if not txt_files:
        print("[ingest] data/ 下没有 .txt 文件，请先放入语料")
        return

    print(f"[ingest] embedding 模型: {EMBED_MODEL} (Ollama)")
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DROP TABLE IF EXISTS chunks")
    conn.execute(
        """
        CREATE TABLE chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            source TEXT,
            meta TEXT,
            embedding BLOB
        )
        """
    )
    conn.commit()

    total = 0
    dim = 0
    for fname in txt_files:
        path = os.path.join(DATA_DIR, fname)
        with open(path, encoding="utf-8") as f:
            raw = f.read()
        cleaned = clean(raw)
        chunks = chunk_text(cleaned)
        source = os.path.splitext(fname)[0]
        print(f"[ingest] {fname}: {len(chunks)} chunks")
        for i in range(0, len(chunks), BATCH_SIZE):
            batch = chunks[i : i + BATCH_SIZE]
            try:
                embs = embed_batch(batch)
            except EmbeddingError as exc:
                conn.close()
                sys.exit(f"[ingest] 失败: {exc}")
            dim = len(embs[0])
            for offset, (ch, emb) in enumerate(zip(batch, embs)):
                conn.execute(
                    "INSERT INTO chunks (text, source, meta, embedding) VALUES (?, ?, ?, ?)",
                    (ch, source, f"chunk-{i + offset}", emb.tobytes()),
                )
                total += 1
            if i % (BATCH_SIZE * 5) == 0:
                print(f"[ingest] {source}: {total} chunks 已入库")
        conn.commit()
    conn.close()
    print(f"[ingest] done: {total} chunks ({dim} 维) -> {DB_PATH}")


if __name__ == "__main__":
    main()

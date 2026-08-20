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


def clean(text: str) -> str:
    """清洗：压缩连续空行、合并行内空白、去空行（OCR 噪声）。"""
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    lines = [l.strip() for l in text.split("\n")]
    lines = [l for l in lines if l]
    return "\n".join(lines)


def chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = OVERLAP) -> list[str]:
    """按段落切块，长段落按长度滑窗。"""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    chunks = []
    for para in paragraphs:
        if len(para) <= size:
            chunks.append(para)
        else:
            start = 0
            while start < len(para):
                chunks.append(para[start : start + size])
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

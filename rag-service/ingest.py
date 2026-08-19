"""语料切块 + embedding + 入库（一次性脚本）。

用法：
  .venv/Scripts/python ingest.py

读取 data/*.txt（力量训练基础、膳食指南 OCR 输出），切块后 embedding 存 data/vectors.db。
"""
import os
import re
import sqlite3
import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = "BAAI/bge-small-zh-v1.5"
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DATA_DIR, "vectors.db")

CHUNK_SIZE = 400  # 每块约 400 字
OVERLAP = 50


def clean(text: str) -> str:
    """清洗：去多余空行、行尾空白、OCR 噪声（连续空行压缩）。"""
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
    print(f"[ingest] loading model {MODEL_NAME} ...")
    model = SentenceTransformer(MODEL_NAME)

    os.makedirs(DATA_DIR, exist_ok=True)
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

    txt_files = [f for f in os.listdir(DATA_DIR) if f.endswith(".txt")]
    if not txt_files:
        print("[ingest] data/ 下没有 .txt 文件，请先放入语料")
        return

    total = 0
    for fname in txt_files:
        path = os.path.join(DATA_DIR, fname)
        with open(path, encoding="utf-8") as f:
            raw = f.read()
        cleaned = clean(raw)
        chunks = chunk_text(cleaned)
        source = os.path.splitext(fname)[0]
        print(f"[ingest] {fname}: {len(chunks)} chunks")
        for i, ch in enumerate(chunks):
            emb = model.encode(ch, normalize_embeddings=True).astype(np.float32)
            conn.execute(
                "INSERT INTO chunks (text, source, meta, embedding) VALUES (?, ?, ?, ?)",
                (ch, source, f"chunk-{i}", emb.tobytes()),
            )
            total += 1
    conn.commit()
    conn.close()
    print(f"[ingest] done: {total} chunks -> {DB_PATH}")


if __name__ == "__main__":
    main()

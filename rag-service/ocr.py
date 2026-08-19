"""膳食指南 PDF OCR（一次性脚本）。

用法：
  .venv/Scripts/python ocr.py "E:/BaiduNetdiskDownload/中国居民膳食指南（2022）.pdf"

流程：pdftoppm 转 PNG -> RapidOCR 逐页识别 -> 拼文本存 data/dietary_guide.txt
图片临时目录默认 D:/tmp/ocr_pages（可用环境变量 RAG_TMP 覆盖），OCR 后自动清理。
"""
import os
import shutil
import sys
import tempfile

from pypdf import PdfReader
from rapidocr_onnxruntime import RapidOCR

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
OUTPUT_TXT = os.path.join(DATA_DIR, "dietary_guide.txt")


def pdf_to_images(pdf_path: str, out_dir: str) -> list[str]:
    """用 pypdf 提取每页嵌入的扫描图片（扫描版 PDF 每页一张图）。"""
    reader = PdfReader(pdf_path)
    paths = []
    for i, page in enumerate(reader.pages, 1):
        for img in page.images:
            p = os.path.join(out_dir, f"page-{i:04d}.jpg")
            with open(p, "wb") as f:
                f.write(img.data)
            paths.append(os.path.basename(p))
    return paths


def main():
    if len(sys.argv) < 2:
        print("用法: python ocr.py <pdf路径>")
        return
    pdf_path = sys.argv[1]
    if not os.path.exists(pdf_path):
        print(f"[ocr] 文件不存在: {pdf_path}")
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    print("[ocr] loading RapidOCR engine ...")
    engine = RapidOCR()

    tmp_base = os.environ.get("RAG_TMP", "D:/tmp/ocr_pages")
    os.makedirs(tmp_base, exist_ok=True)
    img_dir = tempfile.mkdtemp(prefix="ocr_", dir=tmp_base)
    print(f"[ocr] 图片临时目录: {img_dir}")

    try:
        print("[ocr] 转图片 ...")
        imgs = pdf_to_images(pdf_path, img_dir)
        print(f"[ocr] 共 {len(imgs)} 页")

        texts = []
        for i, img in enumerate(imgs, 1):
            path = os.path.join(img_dir, img)
            result, _ = engine(path)
            page_text = ""
            if result:
                page_text = "\n".join(line[1] for line in result)
            texts.append(page_text)
            if i % 20 == 0:
                print(f"[ocr] {i}/{len(imgs)} 页完成")

        full = "\n\n".join(texts)
        with open(OUTPUT_TXT, "w", encoding="utf-8") as f:
            f.write(full)
        print(f"[ocr] done -> {OUTPUT_TXT} ({len(full)} 字)")
    finally:
        shutil.rmtree(img_dir, ignore_errors=True)
        print("[ocr] 临时图片已清理")


if __name__ == "__main__":
    main()

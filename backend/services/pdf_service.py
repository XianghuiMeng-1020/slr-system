from __future__ import annotations
import fitz  # PyMuPDF
from dataclasses import dataclass


@dataclass
class TextBlock:
    text: str
    page: int
    bbox: dict  # {x, y, width, height}


def extract_text_blocks(pdf_path: str) -> list[TextBlock]:
    """Extract text blocks with positions from a PDF file."""
    blocks: list[TextBlock] = []
    doc = fitz.open(pdf_path)
    for page_num in range(len(doc)):
        page = doc[page_num]
        text_dict = page.get_text("dict")
        for block in text_dict.get("blocks", []):
            if block.get("type") == 0:  # text block
                lines_text = []
                for line in block.get("lines", []):
                    spans_text = " ".join(span["text"] for span in line.get("spans", []))
                    if spans_text.strip():
                        lines_text.append(spans_text.strip())
                full_text = " ".join(lines_text).strip()
                if len(full_text) > 20:
                    bbox = block["bbox"]
                    blocks.append(TextBlock(
                        text=full_text,
                        page=page_num + 1,
                        bbox={
                            "x": round(bbox[0], 2),
                            "y": round(bbox[1], 2),
                            "width": round(bbox[2] - bbox[0], 2),
                            "height": round(bbox[3] - bbox[1], 2),
                        },
                    ))
    doc.close()
    return blocks


def get_page_count(pdf_path: str) -> int:
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count

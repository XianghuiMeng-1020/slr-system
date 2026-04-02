from __future__ import annotations
import re
import fitz  # PyMuPDF
from dataclasses import dataclass


@dataclass
class TextBlock:
    text: str
    page: int
    bbox: dict  # {x, y, width, height}
    section: str  # detected section name, e.g. "introduction", "method", "references"


_SECTION_PATTERNS = [
    (re.compile(r"^\s*\d*\.?\s*(abstract)\b", re.I), "abstract"),
    (re.compile(r"^\s*\d*\.?\s*(introduction|background)\b", re.I), "introduction"),
    (re.compile(r"^\s*\d*\.?\s*(literature\s+review|related\s+work|theoretical\s+framework)\b", re.I), "literature_review"),
    (re.compile(r"^\s*\d*\.?\s*(method|methodology|research\s+design|study\s+design|data\s+collection)\b", re.I), "method"),
    (re.compile(r"^\s*\d*\.?\s*(result|finding|analysis|data\s+analysis)\b", re.I), "results"),
    (re.compile(r"^\s*\d*\.?\s*(discussion|implication)\b", re.I), "discussion"),
    (re.compile(r"^\s*\d*\.?\s*(conclusion|summary)\b", re.I), "conclusion"),
    (re.compile(r"^\s*\d*\.?\s*(limitation)\b", re.I), "limitation"),
    (re.compile(r"^\s*\d*\.?\s*(reference|bibliography|works\s+cited)\b", re.I), "references"),
    (re.compile(r"^\s*\d*\.?\s*(appendi|supplementar)\b", re.I), "appendix"),
    (re.compile(r"^\s*\d*\.?\s*(acknowledg)\b", re.I), "acknowledgment"),
]

_SKIP_SECTIONS = {"references", "appendix", "acknowledgment"}


def _detect_section(text: str) -> str | None:
    first_line = text.split("\n")[0].strip()[:120]
    for pattern, section in _SECTION_PATTERNS:
        if pattern.search(first_line):
            return section
    return None


def extract_text_blocks(pdf_path: str, include_all: bool = False) -> list[TextBlock]:
    """Extract text blocks with positions from a PDF file.
    Filters out references/appendix sections unless include_all=True."""
    blocks: list[TextBlock] = []
    doc = fitz.open(pdf_path)
    current_section = "body"
    in_skip_section = False

    for page_num in range(len(doc)):
        page = doc[page_num]
        text_dict = page.get_text("dict")
        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:
                continue
            lines_text = []
            for line in block.get("lines", []):
                spans_text = " ".join(span["text"] for span in line.get("spans", []))
                if spans_text.strip():
                    lines_text.append(spans_text.strip())
            full_text = " ".join(lines_text).strip()
            if len(full_text) < 15:
                continue

            detected = _detect_section(full_text)
            if detected:
                current_section = detected
                in_skip_section = detected in _SKIP_SECTIONS

            if in_skip_section and not include_all:
                continue

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
                    section=current_section,
                ))
    doc.close()
    return blocks


def get_page_count(pdf_path: str) -> int:
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count

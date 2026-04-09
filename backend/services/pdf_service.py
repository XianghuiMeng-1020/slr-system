from __future__ import annotations

import os
import re
from dataclasses import dataclass

import fitz  # PyMuPDF

try:
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore

    _OCR_AVAILABLE = True
except Exception:
    _OCR_AVAILABLE = False


@dataclass
class TextBlock:
    text: str
    page: int
    bbox: dict  # {x, y, width, height}
    section: str
    kind: str = "paragraph"  # paragraph | table | figure_caption | table_caption | ocr

    def to_dict(self) -> dict:
        return {
            "text": self.text,
            "page": self.page,
            "bbox": self.bbox,
            "section": self.section,
            "kind": self.kind,
        }

    @staticmethod
    def from_dict(data: dict) -> "TextBlock":
        return TextBlock(
            text=data.get("text", ""),
            page=int(data.get("page", 1)),
            bbox=data.get("bbox") or {"x": 0, "y": 0, "width": 0, "height": 0},
            section=data.get("section", "body"),
            kind=data.get("kind", "paragraph"),
        )


@dataclass
class SentenceBlock:
    text: str
    page: int
    bbox: dict
    section: str
    parent_block_index: int
    sentence_index: int
    kind: str = "sentence"


_SECTION_PATTERNS = [
    (re.compile(r"^\s*\d*\.?\s*(abstract)\b", re.I), "abstract"),
    (re.compile(r"^\s*\d*\.?\s*(introduction|background)\b", re.I), "introduction"),
    (
        re.compile(r"^\s*\d*\.?\s*(literature\s+review|related\s+work|theoretical\s+framework)\b", re.I),
        "literature_review",
    ),
    (
        re.compile(
            r"^\s*\d*\.?\s*(method|methods|methodology|research\s+design|study\s+design|data\s+collection)\b",
            re.I,
        ),
        "method",
    ),
    (
        re.compile(
            r"^\s*\d*\.?\s*(result|results|finding|findings|analysis|data\s+analysis)\b",
            re.I,
        ),
        "results",
    ),
    (re.compile(r"^\s*\d*\.?\s*(discussion|implication)\b", re.I), "discussion"),
    (re.compile(r"^\s*\d*\.?\s*(conclusion|summary)\b", re.I), "conclusion"),
    (re.compile(r"^\s*\d*\.?\s*(limitation|limitations)\b", re.I), "limitation"),
    (re.compile(r"^\s*\d*\.?\s*(participant|sample)\b", re.I), "participants"),
    (re.compile(r"^\s*\d*\.?\s*(instrument|measure)\b", re.I), "instruments"),
    (re.compile(r"^\s*\d*\.?\s*(ethic|consent|irb)\b", re.I), "ethical_considerations"),
    (re.compile(r"^\s*\d*\.?\s*(reference|bibliography|works\s+cited)\b", re.I), "references"),
    (re.compile(r"^\s*\d*\.?\s*(appendi|supplementar)\b", re.I), "appendix"),
    (re.compile(r"^\s*\d*\.?\s*(acknowledg)\b", re.I), "acknowledgment"),
]

_SKIP_SECTIONS = {"references", "appendix", "acknowledgment"}
_CAPTION_PATTERN = re.compile(r"(?i)^\s*(?:fig(?:ure)?|table)\s*\.?\s*\d+")
_SENT_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _normalize_bbox(raw_bbox: tuple[float, float, float, float] | list[float]) -> dict:
    x0, y0, x1, y1 = raw_bbox
    return {
        "x": round(float(x0), 2),
        "y": round(float(y0), 2),
        "width": round(float(x1) - float(x0), 2),
        "height": round(float(y1) - float(y0), 2),
    }


def _is_upper_heading(text: str) -> bool:
    letters = re.sub(r"[^A-Za-z]", "", text)
    return len(letters) >= 5 and letters.isupper()


def _is_numbered_heading(text: str) -> bool:
    return bool(re.match(r"^\s*\d+(?:\.\d+)*\.?\s+[A-Za-z]", text))


def _detect_section(text: str, avg_font_size: float, page_font_baseline: float) -> str | None:
    first_line = text.split("\n")[0].strip()[:140]
    for pattern, section in _SECTION_PATTERNS:
        if pattern.search(first_line):
            return section

    if _CAPTION_PATTERN.search(first_line):
        if first_line.lower().startswith("table"):
            return "table_caption"
        return "figure_caption"

    likely_heading = _is_upper_heading(first_line) or _is_numbered_heading(first_line)
    if likely_heading or avg_font_size >= (page_font_baseline * 1.2):
        lowered = first_line.lower()
        if "method" in lowered:
            return "method"
        if "result" in lowered or "finding" in lowered:
            return "results"
        if "discussion" in lowered:
            return "discussion"
        if "conclusion" in lowered:
            return "conclusion"
        if "data collection" in lowered:
            return "data_collection"
    return None


def _detect_two_columns(page_blocks: list[dict], page_width: float) -> bool:
    if len(page_blocks) < 8:
        return False
    x_centers = []
    for b in page_blocks:
        bbox = b["bbox"]
        x_centers.append((bbox[0] + bbox[2]) / 2.0)
    x_centers.sort()
    median_x = x_centers[len(x_centers) // 2]
    left = [x for x in x_centers if x < median_x]
    right = [x for x in x_centers if x >= median_x]
    if not left or not right:
        return False
    left_center = sum(left) / len(left)
    right_center = sum(right) / len(right)
    return abs(right_center - left_center) > page_width * 0.25


def _sort_blocks_by_reading_order(page_blocks: list[dict], page_width: float) -> list[dict]:
    if not _detect_two_columns(page_blocks, page_width):
        return sorted(page_blocks, key=lambda b: (b["bbox"][1], b["bbox"][0]))

    median_x = page_width / 2.0
    left_col = [b for b in page_blocks if ((b["bbox"][0] + b["bbox"][2]) / 2.0) < median_x]
    right_col = [b for b in page_blocks if ((b["bbox"][0] + b["bbox"][2]) / 2.0) >= median_x]
    left_col.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
    right_col.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
    return left_col + right_col


def _extract_table_blocks(page: fitz.Page, page_num: int) -> list[TextBlock]:
    table_blocks: list[TextBlock] = []
    try:
        tables = page.find_tables()
        if not tables:
            return table_blocks
        for t in tables.tables:
            markdown = t.to_markdown() or ""
            if not markdown.strip():
                continue
            table_blocks.append(
                TextBlock(
                    text=markdown,
                    page=page_num + 1,
                    bbox=_normalize_bbox(t.bbox),
                    section="table",
                    kind="table",
                )
            )
    except Exception:
        pass
    return table_blocks


def _extract_ocr_blocks(doc: fitz.Document) -> list[TextBlock]:
    if not _OCR_AVAILABLE:
        return []
    ocr_blocks: list[TextBlock] = []
    for page_idx in range(len(doc)):
        page = doc[page_idx]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)  # type: ignore[arg-type]
        data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
        texts = []
        for i, txt in enumerate(data.get("text", [])):
            cleaned = (txt or "").strip()
            conf = data.get("conf", ["-1"])[i]
            try:
                conf_val = float(conf)
            except Exception:
                conf_val = -1
            if cleaned and conf_val >= 40:
                texts.append(cleaned)
        joined = " ".join(texts).strip()
        if len(joined) < 20:
            continue
        rect = page.rect
        ocr_blocks.append(
            TextBlock(
                text=joined,
                page=page_idx + 1,
                bbox={"x": 0, "y": 0, "width": round(rect.width, 2), "height": round(rect.height, 2)},
                section="body",
                kind="ocr",
            )
        )
    return ocr_blocks


MAX_PAGES_DEFAULT = int(os.getenv("MAX_PAGES_PER_DOC", "30"))


def extract_text_blocks(pdf_path: str, include_all: bool = False, max_pages: int | None = None) -> list[TextBlock]:
    blocks: list[TextBlock] = []
    doc = fitz.open(pdf_path)
    current_section = "body"
    in_skip_section = False
    page_limit = len(doc) if include_all else min(len(doc), max_pages or MAX_PAGES_DEFAULT)

    for page_num in range(page_limit):
        page = doc[page_num]
        text_dict = page.get_text("dict")
        raw_text_blocks = [b for b in text_dict.get("blocks", []) if b.get("type") == 0]
        ordered_blocks = _sort_blocks_by_reading_order(raw_text_blocks, page.rect.width)

        font_sizes = []
        for rb in ordered_blocks:
            for line in rb.get("lines", []):
                for span in line.get("spans", []):
                    size = span.get("size")
                    if isinstance(size, (float, int)):
                        font_sizes.append(float(size))
        baseline_font = (sum(font_sizes) / len(font_sizes)) if font_sizes else 10.0

        for block in ordered_blocks:
            lines_text: list[str] = []
            line_sizes: list[float] = []
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                spans_text = " ".join(str(span.get("text", "")) for span in spans).strip()
                if spans_text:
                    lines_text.append(spans_text)
                for span in spans:
                    size = span.get("size")
                    if isinstance(size, (float, int)):
                        line_sizes.append(float(size))

            full_text = " ".join(lines_text).strip()
            if len(full_text) < 15:
                continue

            avg_size = (sum(line_sizes) / len(line_sizes)) if line_sizes else baseline_font
            detected = _detect_section(full_text, avg_size, baseline_font)
            if detected:
                if detected in ("figure_caption", "table_caption"):
                    section_for_caption = detected
                else:
                    current_section = detected
                    in_skip_section = detected in _SKIP_SECTIONS
                    section_for_caption = current_section
            else:
                section_for_caption = current_section

            if in_skip_section and not include_all:
                continue
            if len(full_text) <= 20:
                continue

            kind = "paragraph"
            if section_for_caption in ("figure_caption", "table_caption"):
                kind = section_for_caption

            blocks.append(
                TextBlock(
                    text=full_text,
                    page=page_num + 1,
                    bbox=_normalize_bbox(block["bbox"]),
                    section=section_for_caption,
                    kind=kind,
                )
            )

        # Supplement paragraph extraction with structured table text.
        blocks.extend(_extract_table_blocks(page, page_num))

    if len(blocks) < 5 and len(doc) > 2:
        blocks.extend(_extract_ocr_blocks(doc))

    doc.close()
    return blocks


def split_into_sentence_blocks(text_blocks: list[TextBlock]) -> list[SentenceBlock]:
    sentence_blocks: list[SentenceBlock] = []
    for parent_idx, block in enumerate(text_blocks):
        sentences = [s.strip() for s in _SENT_SPLIT_RE.split(block.text) if s.strip()]
        if not sentences:
            continue
        unit_height = block.bbox["height"] / max(len(sentences), 1)
        for sent_idx, sent in enumerate(sentences):
            sentence_blocks.append(
                SentenceBlock(
                    text=sent,
                    page=block.page,
                    bbox={
                        "x": block.bbox["x"],
                        "y": round(block.bbox["y"] + unit_height * sent_idx, 2),
                        "width": block.bbox["width"],
                        "height": round(unit_height, 2),
                    },
                    section=block.section,
                    parent_block_index=parent_idx,
                    sentence_index=sent_idx,
                )
            )
    return sentence_blocks


def get_page_count(pdf_path: str) -> int:
    doc = fitz.open(pdf_path)
    count = len(doc)
    doc.close()
    return count

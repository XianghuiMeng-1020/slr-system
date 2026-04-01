from __future__ import annotations
import json
import os
import uuid
from dataclasses import dataclass

from services.pdf_service import TextBlock

try:
    from openai import OpenAI
    _openai_available = True
except ImportError:
    _openai_available = False


@dataclass
class LabelResult:
    scheme_item_id: str
    value: str  # Present, Absent, Unclear
    confidence: float


@dataclass
class EvidenceResult:
    text: str
    page: int
    bbox: dict
    relevant_code_ids: list[str]


def _get_client() -> "OpenAI | None":
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key or not _openai_available:
        return None
    return OpenAI(api_key=api_key)


def generate_labels(
    text_blocks: list[TextBlock],
    scheme: list[dict],
) -> list[LabelResult]:
    """Use LLM to assign labels for each coding scheme item, with fallback to heuristic."""
    client = _get_client()
    if client:
        return _llm_generate_labels(client, text_blocks, scheme)
    return _heuristic_labels(text_blocks, scheme)


def extract_evidences(
    text_blocks: list[TextBlock],
    scheme: list[dict],
) -> list[EvidenceResult]:
    """Use LLM to extract evidence passages, with fallback to heuristic."""
    client = _get_client()
    if client:
        return _llm_extract_evidences(client, text_blocks, scheme)
    return _heuristic_evidences(text_blocks, scheme)


def _llm_generate_labels(
    client: "OpenAI",
    text_blocks: list[TextBlock],
    scheme: list[dict],
) -> list[LabelResult]:
    full_text = "\n\n".join(b.text for b in text_blocks[:80])
    scheme_desc = "\n".join(
        f"- {s['code']}: {s['description']} (id: {s['id']})" for s in scheme
    )

    prompt = f"""You are an academic coding assistant for systematic literature reviews.

Given the following document text and coding scheme, determine for each code whether it is Present, Absent, or Unclear in the document.
Return a JSON array of objects with keys: scheme_item_id, value (Present/Absent/Unclear), confidence (0.0-1.0).

Coding Scheme:
{scheme_desc}

Document Text (excerpt):
{full_text[:8000]}

Return ONLY valid JSON array, no explanation."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2000,
        )
        content = response.choices[0].message.content or "[]"
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0]
        results = json.loads(content)
        return [
            LabelResult(
                scheme_item_id=r["scheme_item_id"],
                value=r.get("value", "Unclear"),
                confidence=float(r.get("confidence", 0.5)),
            )
            for r in results
        ]
    except Exception:
        return _heuristic_labels(text_blocks, scheme)


def _llm_extract_evidences(
    client: "OpenAI",
    text_blocks: list[TextBlock],
    scheme: list[dict],
) -> list[EvidenceResult]:
    block_refs = []
    for i, b in enumerate(text_blocks[:80]):
        block_refs.append(f"[Block {i}, Page {b.page}]: {b.text}")

    scheme_desc = "\n".join(
        f"- {s['code']}: {s['description']} (id: {s['id']})" for s in scheme
    )

    prompt = f"""You are an evidence extraction assistant for systematic literature reviews.

Given the text blocks from a research paper and a coding scheme, identify text blocks that serve as evidence for coding decisions.
For each piece of evidence, return: the block index, which coding scheme item(s) it relates to, and a brief reason.

Return a JSON array of objects with keys: block_index (int), relevant_code_ids (list of scheme item ids), reason (string).
Select 4-10 most relevant evidence passages.

Coding Scheme:
{scheme_desc}

Text Blocks:
{chr(10).join(block_refs[:60])}

Return ONLY valid JSON array, no explanation."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=2000,
        )
        content = response.choices[0].message.content or "[]"
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1].rsplit("```", 1)[0]
        results = json.loads(content)
        evidences = []
        for r in results:
            idx = r.get("block_index", 0)
            if 0 <= idx < len(text_blocks):
                b = text_blocks[idx]
                evidences.append(EvidenceResult(
                    text=b.text,
                    page=b.page,
                    bbox=b.bbox,
                    relevant_code_ids=r.get("relevant_code_ids", []),
                ))
        return evidences
    except Exception:
        return _heuristic_evidences(text_blocks, scheme)


# --- Heuristic fallbacks (no API key needed) ---

_KEYWORDS = {
    "methodology": ["method", "design", "approach", "procedure", "protocol"],
    "sample": ["sample", "participant", "subject", "recruit", "n =", "n="],
    "analysis": ["analy", "statistic", "regression", "t-test", "anova", "chi-square"],
    "results": ["result", "finding", "significant", "p <", "p=", "effect size", "outcome"],
    "ethics": ["ethic", "consent", "irb", "review board", "approv"],
    "limitation": ["limit", "weakness", "bias", "generalizab"],
    "quality": ["valid", "reliab", "trustworth", "rigor"],
    "implication": ["implic", "recommend", "future", "practice", "policy"],
}


def _heuristic_labels(
    text_blocks: list[TextBlock],
    scheme: list[dict],
) -> list[LabelResult]:
    import random
    full_text = " ".join(b.text.lower() for b in text_blocks)
    results = []
    for s in scheme:
        desc_lower = s["description"].lower()
        score = 0.5
        for category, keywords in _KEYWORDS.items():
            if any(kw in desc_lower for kw in keywords):
                if any(kw in full_text for kw in keywords):
                    score = 0.7 + random.random() * 0.25
                    break
        value = "Present" if score > 0.65 else ("Unclear" if score > 0.45 else "Absent")
        results.append(LabelResult(
            scheme_item_id=s["id"],
            value=value,
            confidence=round(score, 2),
        ))
    return results


def _heuristic_evidences(
    text_blocks: list[TextBlock],
    scheme: list[dict],
) -> list[EvidenceResult]:
    scored: list[tuple[float, TextBlock, list[str]]] = []
    for block in text_blocks:
        text_lower = block.text.lower()
        matched_codes: list[str] = []
        total_score = 0.0
        for s in scheme:
            desc_lower = s["description"].lower()
            for keywords in _KEYWORDS.values():
                if any(kw in desc_lower for kw in keywords) and any(kw in text_lower for kw in keywords):
                    matched_codes.append(s["id"])
                    total_score += 1.0
                    break
        if matched_codes:
            scored.append((total_score, block, matched_codes))

    scored.sort(key=lambda x: x[0], reverse=True)
    evidences = []
    for score, block, codes in scored[:8]:
        evidences.append(EvidenceResult(
            text=block.text,
            page=block.page,
            bbox=block.bbox,
            relevant_code_ids=list(set(codes)),
        ))
    return evidences

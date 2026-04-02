from __future__ import annotations
import json
import os
import re
from dataclasses import dataclass

from services.pdf_service import TextBlock

try:
    from openai import OpenAI
    _openai_available = True
except ImportError:
    _openai_available = False

_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = "qwen-plus"


@dataclass
class LabelResult:
    scheme_item_id: str
    value: str
    confidence: float


@dataclass
class EvidenceResult:
    text: str
    page: int
    bbox: dict
    relevant_code_ids: list[str]


def _get_client() -> "OpenAI | None":
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key or not _openai_available:
        return None
    base_url = os.getenv("LLM_BASE_URL", _DEFAULT_BASE_URL)
    return OpenAI(api_key=api_key, base_url=base_url)


def _get_model() -> str:
    return os.getenv("LLM_MODEL", _DEFAULT_MODEL)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_labels(text_blocks: list[TextBlock], scheme: list[dict]) -> list[LabelResult]:
    client = _get_client()
    if client:
        return _llm_generate_labels(client, text_blocks, scheme)
    return _heuristic_labels(text_blocks, scheme)


def extract_evidences(text_blocks: list[TextBlock], scheme: list[dict]) -> list[EvidenceResult]:
    client = _get_client()
    if client:
        return _llm_extract_evidences(client, text_blocks, scheme)
    return _heuristic_evidences(text_blocks, scheme)


# ---------------------------------------------------------------------------
# LLM-powered
# ---------------------------------------------------------------------------

def _llm_generate_labels(client: "OpenAI", text_blocks: list[TextBlock], scheme: list[dict]) -> list[LabelResult]:
    full_text = "\n\n".join(b.text for b in text_blocks[:100])
    scheme_desc = "\n".join(f"- {s['code']}: {s['description']} (id: {s['id']})" for s in scheme)

    prompt = f"""You are an expert academic coding assistant for systematic literature reviews (SLR).

Given the document text and coding scheme below, determine for EACH code whether the concept is Present, Absent, or Unclear in the document.

Rules:
- "Present" = the document explicitly discusses or addresses this concept
- "Absent" = the document clearly does NOT discuss this concept
- "Unclear" = insufficient evidence to determine

Return a JSON array with keys: scheme_item_id, value (Present/Absent/Unclear), confidence (0.0-1.0).

Coding Scheme:
{scheme_desc}

Document Text:
{full_text[:12000]}

Return ONLY valid JSON array."""

    model = _get_model()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=3000,
        )
        content = _clean_json_response(resp.choices[0].message.content or "[]")
        results = json.loads(content)
        return [
            LabelResult(
                scheme_item_id=r["scheme_item_id"],
                value=r.get("value", "Unclear"),
                confidence=float(r.get("confidence", 0.5)),
            )
            for r in results
        ]
    except Exception as e:
        print(f"[AI] Label generation failed ({model}): {e}")
        return _heuristic_labels(text_blocks, scheme)


def _llm_extract_evidences(client: "OpenAI", text_blocks: list[TextBlock], scheme: list[dict]) -> list[EvidenceResult]:
    content_blocks = [b for b in text_blocks if b.section not in ("references", "appendix", "acknowledgment")]
    block_refs = [f"[Block {i}, Page {b.page}, Section: {b.section}]: {b.text}" for i, b in enumerate(content_blocks[:120])]
    scheme_desc = "\n".join(f"- {s['code']}: {s['description']} (id: {s['id']})" for s in scheme)

    prompt = f"""You are an expert evidence extraction assistant for systematic literature reviews.

Task: From the text blocks of a research paper, identify passages that serve as direct evidence for coding decisions.

IMPORTANT RULES:
1. Select 10-25 most relevant evidence passages (more is better for thoroughness)
2. Focus on substantive content: methodology descriptions, data/results, key findings, theoretical claims
3. DO NOT select references, citations-only blocks, page headers/footers, or table-of-contents
4. Prefer blocks from method, results, and discussion sections
5. Each evidence should clearly relate to at least one coding scheme item
6. Include the specific reason WHY this text serves as evidence

Return a JSON array of objects with keys:
- block_index (int): index of the block
- relevant_code_ids (list of strings): scheme item IDs this evidence relates to
- reason (string): brief explanation of why this is evidence

Coding Scheme:
{scheme_desc}

Text Blocks:
{chr(10).join(block_refs)}

Return ONLY valid JSON array."""

    model = _get_model()
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=4000,
        )
        content = _clean_json_response(resp.choices[0].message.content or "[]")
        results = json.loads(content)
        evidences = []
        for r in results:
            idx = r.get("block_index", -1)
            if 0 <= idx < len(content_blocks):
                b = content_blocks[idx]
                evidences.append(EvidenceResult(
                    text=b.text,
                    page=b.page,
                    bbox=b.bbox,
                    relevant_code_ids=r.get("relevant_code_ids", []),
                ))
        return evidences
    except Exception as e:
        print(f"[AI] Evidence extraction failed ({model}): {e}")
        return _heuristic_evidences(text_blocks, scheme)


def _clean_json_response(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return text.strip()


# ---------------------------------------------------------------------------
# Heuristic fallback (no API key)
# ---------------------------------------------------------------------------

_ACADEMIC_KEYWORDS = {
    "methodology": ["method", "design", "approach", "procedure", "protocol", "framework",
                     "qualitative", "quantitative", "mixed method", "case study", "survey",
                     "experiment", "interview", "observation", "grounded theory", "ethnograph"],
    "sample": ["sample", "participant", "subject", "recruit", "n =", "n=", "respondent",
               "population", "demographic", "age", "gender", "male", "female", "student",
               "teacher", "learner", "user", "employee", "patient"],
    "data_collection": ["data collect", "instrument", "questionnaire", "interview guide",
                        "focus group", "survey instrument", "likert", "scale", "measure",
                        "assessment", "test", "rubric", "log", "recording", "transcript"],
    "analysis": ["analy", "statistic", "regression", "t-test", "anova", "chi-square",
                 "thematic", "coding", "content analysis", "narrative", "discourse",
                 "correlation", "factor analysis", "structural equation", "SEM",
                 "descriptive", "inferential", "mean", "standard deviation", "frequency"],
    "results": ["result", "finding", "significant", "p <", "p=", "effect size", "outcome",
                "showed", "revealed", "indicated", "demonstrated", "emerged", "theme",
                "category", "pattern", "trend", "increase", "decrease", "difference"],
    "technology": ["technology", "software", "tool", "platform", "system", "application",
                   "AI", "artificial intelligence", "machine learning", "chatbot", "LLM",
                   "GPT", "algorithm", "neural", "deep learning", "NLP", "automation",
                   "digital", "online", "virtual", "computer", "interface"],
    "education": ["education", "learning", "teaching", "pedagogy", "curriculum", "classroom",
                  "instruction", "assessment", "academic", "school", "university", "course",
                  "student", "teacher", "faculty", "higher education", "K-12", "e-learning"],
    "ethics": ["ethic", "consent", "IRB", "review board", "approv", "privacy", "bias",
               "fairness", "responsible", "transparency", "accountability"],
    "limitation": ["limit", "weakness", "bias", "generalizab", "constraint", "challenge",
                   "barrier", "threat to validity", "small sample", "future research"],
    "context": ["context", "setting", "environment", "country", "region", "institution",
                "organization", "workplace", "hospital", "clinic", "field"],
    "theory": ["theory", "theoretical", "conceptual framework", "model", "construct",
               "hypothesis", "proposition", "paradigm", "lens", "perspective"],
    "quality": ["valid", "reliab", "trustworth", "rigor", "credib", "transferab",
                "confirmab", "dependab", "triangulat", "member check", "inter-rater"],
    "effect": ["effect", "impact", "influence", "relationship", "association", "predict",
               "mediat", "moderat", "correlat", "cause", "contribut"],
}

_NOISE_PATTERNS = re.compile(
    r"(^\d{1,3}$|^table\s+\d|^figure\s+\d|^fig\.\s*\d|^\s*©|doi:|https?://|"
    r"all rights reserved|accepted.*\d{4}|received.*\d{4}|published.*\d{4}|"
    r"correspondence.*@|journal of|issn\s|vol\.\s|pp\.\s)",
    re.I,
)


def _is_noise(text: str) -> bool:
    return bool(_NOISE_PATTERNS.search(text[:200])) or len(text.split()) < 8


def _extract_scheme_keywords(scheme: list[dict]) -> list[str]:
    """Extract meaningful words from the coding scheme descriptions."""
    stop = {"the", "a", "an", "and", "or", "of", "in", "to", "for", "is", "are",
            "was", "were", "be", "been", "has", "have", "had", "with", "on", "at",
            "by", "from", "that", "this", "it", "its", "as", "not", "but", "if",
            "do", "does", "did", "will", "would", "can", "could", "may", "might",
            "shall", "should", "each", "every", "all", "any", "some", "no", "than",
            "about", "between", "through", "during", "before", "after", "how", "what",
            "which", "who", "whom", "where", "when", "why"}
    words = set()
    for s in scheme:
        for field in [s.get("code", ""), s.get("description", "")]:
            for w in re.findall(r"[a-zA-Z]{3,}", field.lower()):
                if w not in stop:
                    words.add(w)
    return list(words)


def _heuristic_labels(text_blocks: list[TextBlock], scheme: list[dict]) -> list[LabelResult]:
    full_text = " ".join(b.text.lower() for b in text_blocks)
    scheme_kws = _extract_scheme_keywords(scheme)
    results = []

    for s in scheme:
        desc_words = set(re.findall(r"[a-zA-Z]{3,}", s["description"].lower()))
        code_words = set(re.findall(r"[a-zA-Z]{3,}", s.get("code", "").lower()))
        all_words = desc_words | code_words

        direct_hits = sum(1 for w in all_words if w in full_text)
        keyword_hits = 0
        for cat_keywords in _ACADEMIC_KEYWORDS.values():
            overlap = sum(1 for kw in cat_keywords if kw in s["description"].lower())
            if overlap > 0:
                found = sum(1 for kw in cat_keywords if kw in full_text)
                keyword_hits += min(found, 3)

        total = direct_hits * 2 + keyword_hits
        max_possible = max(len(all_words) * 2 + 6, 1)
        score = min(total / max_possible, 1.0)
        score = round(score * 0.6 + 0.2, 2)

        if score >= 0.55:
            value = "Present"
        elif score >= 0.35:
            value = "Unclear"
        else:
            value = "Absent"

        results.append(LabelResult(scheme_item_id=s["id"], value=value, confidence=score))
    return results


def _heuristic_evidences(text_blocks: list[TextBlock], scheme: list[dict]) -> list[EvidenceResult]:
    content_blocks = [b for b in text_blocks
                      if b.section not in ("references", "appendix", "acknowledgment")
                      and not _is_noise(b.text)]

    scheme_kws = _extract_scheme_keywords(scheme)
    all_kw_lists = list(_ACADEMIC_KEYWORDS.values())

    scored: list[tuple[float, TextBlock, list[str]]] = []

    for block in content_blocks:
        text_lower = block.text.lower()
        word_count = len(text_lower.split())

        length_bonus = min(word_count / 60, 1.0) * 0.3

        section_bonus = {
            "method": 0.4, "results": 0.5, "discussion": 0.3,
            "introduction": 0.15, "literature_review": 0.2,
            "conclusion": 0.2, "limitation": 0.3,
        }.get(block.section, 0.1)

        scheme_hits = sum(1 for kw in scheme_kws if kw in text_lower)
        scheme_score = min(scheme_hits / max(len(scheme_kws), 1) * 3, 1.0) * 0.5

        matched_codes: list[str] = []
        for s in scheme:
            desc_words = set(re.findall(r"[a-zA-Z]{3,}", s["description"].lower()))
            code_words = set(re.findall(r"[a-zA-Z]{3,}", s.get("code", "").lower()))
            all_words = desc_words | code_words
            hits = sum(1 for w in all_words if w in text_lower)
            if hits >= max(len(all_words) * 0.3, 1):
                matched_codes.append(s["id"])

        keyword_hits = 0
        for kw_list in all_kw_lists:
            keyword_hits += sum(1 for kw in kw_list if kw in text_lower)
        keyword_score = min(keyword_hits / 8, 1.0) * 0.3

        total_score = section_bonus + scheme_score + keyword_score + length_bonus

        if matched_codes or total_score > 0.5:
            if not matched_codes:
                best_scheme = max(scheme, key=lambda s: sum(
                    1 for w in re.findall(r"[a-zA-Z]{3,}", s["description"].lower()) if w in text_lower
                ))
                matched_codes = [best_scheme["id"]]
            scored.append((total_score, block, matched_codes))

    scored.sort(key=lambda x: x[0], reverse=True)

    seen_pages: dict[int, int] = {}
    evidences = []
    for score, block, codes in scored:
        page_count = seen_pages.get(block.page, 0)
        if page_count >= 4:
            continue
        seen_pages[block.page] = page_count + 1
        evidences.append(EvidenceResult(
            text=block.text,
            page=block.page,
            bbox=block.bbox,
            relevant_code_ids=list(set(codes)),
        ))
        if len(evidences) >= 20:
            break

    return evidences

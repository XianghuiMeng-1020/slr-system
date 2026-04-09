from __future__ import annotations
import json
import logging
import math
import os
import re
import threading
import time
from dataclasses import dataclass

from services.pdf_service import TextBlock, split_into_sentence_blocks

try:
    from openai import OpenAI
    _openai_available = True
except ImportError:
    _openai_available = False

try:
    import json5  # type: ignore
    _json5_available = True
except Exception:
    _json5_available = False

_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = "qwen-plus"
_MAX_LLM_CONCURRENCY = 5
_LLM_SEMAPHORE = threading.Semaphore(_MAX_LLM_CONCURRENCY)
logger = logging.getLogger(__name__)


@dataclass
class LabelResult:
    scheme_item_id: str
    value: str
    confidence: float
    supporting_evidence_ids: list[str] | None = None


@dataclass
class EvidenceResult:
    id: str
    text: str
    page: int
    bbox: dict
    relevant_code_ids: list[str]
    ai_reason: str | None = None
    confidence: float | None = None
    extracted_stats: list[dict] | None = None
    exact_quote: str | None = None
    evidence_type: str | None = None


def _get_client() -> "OpenAI | None":
    api_key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key or not _openai_available:
        return None
    base_url = os.getenv("LLM_BASE_URL", _DEFAULT_BASE_URL)
    return OpenAI(api_key=api_key, base_url=base_url)


def _get_model() -> str:
    return os.getenv("LLM_MODEL", _DEFAULT_MODEL)


def _gen_id(prefix: str = "ev") -> str:
    return f"{prefix}_{os.urandom(4).hex()}"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_labels(
    text_blocks: list[TextBlock],
    scheme: list[dict],
    evidences: list[EvidenceResult] | None = None,
    extra_context: str | None = None,
) -> list[LabelResult]:
    client = _get_client()
    if client:
        return _llm_generate_labels(
            client, text_blocks, scheme, evidences=evidences, extra_context=extra_context
        )
    return _heuristic_labels(text_blocks, scheme, evidences=evidences)


def extract_evidences(
    text_blocks: list[TextBlock],
    scheme: list[dict],
    extra_context: str | None = None,
) -> list[EvidenceResult]:
    client = _get_client()
    if client:
        return _llm_extract_evidences(client, text_blocks, scheme, extra_context=extra_context)
    return _heuristic_evidences(text_blocks, scheme)


# ---------------------------------------------------------------------------
# LLM-powered
# ---------------------------------------------------------------------------

def _call_llm_with_retry(client: "OpenAI", messages: list[dict], max_tokens: int) -> str:
    model = _get_model()
    max_attempts = 3
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            with _LLM_SEMAPHORE:
                resp = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    temperature=0.1,
                    max_tokens=max_tokens,
                )
            return resp.choices[0].message.content or "[]"
        except Exception as e:
            last_error = e
            if attempt < max_attempts:
                time.sleep(0.8 * (2 ** (attempt - 1)))
    raise RuntimeError(f"LLM call failed after retries: {last_error}")


def _select_blocks_for_labeling(text_blocks: list[TextBlock], limit: int = 160) -> list[TextBlock]:
    section_weight = {
        "results": 5,
        "method": 4,
        "discussion": 4,
        "conclusion": 3,
        "introduction": 2,
        "literature_review": 1,
        "table": 5,
        "figure_caption": 4,
        "table_caption": 4,
    }
    scored = sorted(
        text_blocks,
        key=lambda b: (
            section_weight.get(b.section, 1),
            1 if b.kind in ("table", "figure_caption", "table_caption") else 0,
            min(len(b.text), 1000),
        ),
        reverse=True,
    )
    return scored[:limit]


def _chunk_text_blocks(text_blocks: list[TextBlock], chunk_size_chars: int = 12000) -> list[str]:
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0
    for b in text_blocks:
        line = f"[p.{b.page}/{b.section}] {b.text}"
        if current and current_len + len(line) > chunk_size_chars:
            chunks.append("\n".join(current))
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len += len(line)
    if current:
        chunks.append("\n".join(current))
    return chunks


def _llm_generate_labels(
    client: "OpenAI",
    text_blocks: list[TextBlock],
    scheme: list[dict],
    evidences: list[EvidenceResult] | None = None,
    extra_context: str | None = None,
) -> list[LabelResult]:
    selected_blocks = _select_blocks_for_labeling(text_blocks)
    chunks = _chunk_text_blocks(selected_blocks, chunk_size_chars=10000)
    scheme_desc = "\n".join(f"- {s['code']}: {s['description']} (id: {s['id']})" for s in scheme)

    evidence_hint = ""
    if evidences:
        refs = []
        for ev in evidences[:50]:
            refs.append(f"- {ev.id} [p.{ev.page}] codes={','.join(ev.relevant_code_ids)} :: {ev.text[:180]}")
        evidence_hint = "Candidate evidence:\n" + "\n".join(refs)

    project_hint = ""
    if extra_context and extra_context.strip():
        project_hint = f"\n\nProject-specific instructions and prior feedback:\n{extra_context.strip()}\n"

    merged_scores: dict[str, list[float]] = {}
    for chunk in chunks:
        prompt = f"""You are an expert academic coding assistant for systematic literature reviews (SLR).
{project_hint}
Given the document chunk and coding scheme, determine for EACH code whether the concept is Present, Absent, or Unclear.
Use candidate evidence if provided.

Rules:
- "Present" = explicit support in text
- "Absent" = clearly not discussed
- "Unclear" = insufficient support
- Keep confidence between 0 and 1

Coding Scheme:
{scheme_desc}

{evidence_hint}

Document Chunk:
{chunk}

Return ONLY valid JSON array."""
        try:
            content = _clean_json_response(
                _call_llm_with_retry(
                    client,
                    messages=[{"role": "system", "content": "Return strict JSON only."}, {"role": "user", "content": prompt}],
                    max_tokens=2800,
                )
            )
            results = _parse_json_array(content)
            for r in results:
                sid = r.get("scheme_item_id")
                if not sid:
                    continue
                conf = float(r.get("confidence", 0.5))
                merged_scores.setdefault(sid, []).append(conf if r.get("value") == "Present" else -conf)
        except Exception as e:
            logger.warning("LLM label chunk failed: %s", e)

    if not merged_scores:
        logger.warning("[AI] Label generation failed (%s): no valid outputs", _get_model())
        return _heuristic_labels(text_blocks, scheme, evidences=evidences)

    final: list[LabelResult] = []
    for s in scheme:
        vals = merged_scores.get(s["id"], [])
        if not vals:
            final.append(LabelResult(scheme_item_id=s["id"], value="Unclear", confidence=0.35))
            continue
        avg = sum(vals) / len(vals)
        confidence = min(max(abs(avg), 0.2), 0.99)
        if avg >= 0.2:
            value = "Present"
        elif avg <= -0.2:
            value = "Absent"
        else:
            value = "Unclear"
        final.append(
            LabelResult(
                scheme_item_id=s["id"],
                value=value,
                confidence=round(confidence, 2),
                supporting_evidence_ids=[
                    ev.id for ev in (evidences or []) if s["id"] in (ev.relevant_code_ids or [])
                ][:12],
            )
        )
    return final


def _llm_extract_evidences(
    client: "OpenAI",
    text_blocks: list[TextBlock],
    scheme: list[dict],
    extra_context: str | None = None,
) -> list[EvidenceResult]:
    sentence_blocks = split_into_sentence_blocks(text_blocks)
    content_blocks = [
        b for b in sentence_blocks
        if b.section not in ("references", "appendix", "acknowledgment")
    ]
    content_blocks = content_blocks[:320]
    if not content_blocks:
        return _heuristic_evidences(text_blocks, scheme)

    block_refs = [
        f"[Sentence {i}, Page {b.page}, Section: {b.section}]: {b.text}"
        for i, b in enumerate(content_blocks)
    ]
    scheme_desc = "\n".join(f"- {s['code']}: {s['description']} (id: {s['id']})" for s in scheme)

    project_hint = ""
    if extra_context and extra_context.strip():
        project_hint = f"\n\nProject-specific instructions and prior feedback:\n{extra_context.strip()}\n"

    first_pass_prompt = f"""You are an expert evidence extraction assistant for systematic literature reviews.
{project_hint}
Task: Select candidate evidence SENTENCES from a research paper.

IMPORTANT RULES:
1. Select 25-80 candidate sentences.
2. Prefer method/results/discussion and high-information sentences.
3. Include statistical or numerical statements when available.
4. For each selected sentence, map to at least one coding scheme item.

Return a JSON array of objects with keys:
- sentence_index (int)
- relevant_code_ids (list[str])
- reason (string)

Coding Scheme:
{scheme_desc}

Candidate Sentences:
{chr(10).join(block_refs)}

Return ONLY valid JSON array."""

    try:
        first_pass_content = _clean_json_response(
            _call_llm_with_retry(
                client,
                messages=[
                    {"role": "system", "content": "Return strict JSON array only."},
                    {"role": "user", "content": first_pass_prompt},
                ],
                max_tokens=4500,
            )
        )
        first_pass = _parse_json_array(first_pass_content)

        selected: list[tuple[int, list[str], str]] = []
        for r in first_pass:
            idx = r.get("sentence_index", -1)
            if 0 <= idx < len(content_blocks):
                selected.append((idx, r.get("relevant_code_ids", []), r.get("reason", "")))

        if not selected:
            return _heuristic_evidences(text_blocks, scheme)

        # Pass 2: enrich each selected evidence with quote/type/stats/confidence.
        selected_refs = []
        for local_idx, (idx, code_ids, reason) in enumerate(selected[:120]):
            b = content_blocks[idx]
            selected_refs.append(
                f"[Item {local_idx}] sentence_index={idx}; text={b.text}; codes={code_ids}; reason={reason}"
            )
        second_pass_prompt = f"""Enrich evidence candidates with metadata.
{project_hint}
Return JSON array with:
- item_index (int)
- exact_quote (string, 1-2 precise sentences)
- confidence (0-1)
- evidence_type (statistical|methodological|qualitative|definitional|contextual)
- key_statistics (list of {{type, value}})
Return JSON only.

Candidates:
{chr(10).join(selected_refs)}
"""
        second_pass_content = _clean_json_response(
            _call_llm_with_retry(
                client,
                messages=[
                    {"role": "system", "content": "Return strict JSON array only."},
                    {"role": "user", "content": second_pass_prompt},
                ],
                max_tokens=4200,
            )
        )
        enriched = _parse_json_array(second_pass_content)
        enriched_map = {int(x.get("item_index", -1)): x for x in enriched}

        evidences: list[EvidenceResult] = []
        for local_idx, (idx, code_ids, reason) in enumerate(selected):
            b = content_blocks[idx]
            info = enriched_map.get(local_idx, {})
            stats = info.get("key_statistics")
            if not isinstance(stats, list):
                stats = _extract_numerical_evidence(b.text)
            evidences.append(
                EvidenceResult(
                    id=_gen_id(),
                    text=b.text,
                    page=b.page,
                    bbox=b.bbox,
                    relevant_code_ids=[str(c) for c in code_ids],
                    ai_reason=reason,
                    confidence=float(info.get("confidence", 0.55)),
                    extracted_stats=stats,
                    exact_quote=info.get("exact_quote", b.text[:220]),
                    evidence_type=info.get("evidence_type", "contextual"),
                )
            )
        return _deduplicate_evidences(_apply_adaptive_evidence_limit(evidences, text_blocks, scheme))
    except Exception as e:
        logger.warning("[AI] Evidence extraction failed (%s): %s", _get_model(), e)
        return _heuristic_evidences(text_blocks, scheme)


def _clean_json_response(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0]
    return text.strip().replace("\u200b", "")


def _parse_json_array(text: str) -> list[dict]:
    cleaned = _clean_json_response(text)
    try:
        parsed = json.loads(cleaned)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        pass
    match = re.search(r"\[[\s\S]*\]", cleaned)
    if match:
        candidate = match.group(0)
        for closer in ("]", "}"):
            if candidate.count(closer) < cleaned.count(closer):
                candidate += closer
        try:
            parsed = json.loads(candidate)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            if _json5_available:
                try:
                    parsed = json5.loads(candidate)
                    return parsed if isinstance(parsed, list) else []
                except Exception:
                    return []
    if _json5_available:
        try:
            parsed = json5.loads(cleaned)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


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

_STAT_PATTERNS = {
    "p_value": re.compile(r"\bp\s*[<>=≤≥]\s*\.?\d+\b", re.I),
    "sample_size": re.compile(r"\b[Nn]\s*=\s*\d+\b"),
    "effect_size_d": re.compile(r"\b[dD]\s*=\s*-?\d+\.?\d*\b"),
    "effect_size_r": re.compile(r"\b[rR]\s*=\s*-?\d+\.?\d*\b"),
    "odds_ratio": re.compile(r"\bOR\s*=\s*\d+\.?\d*\b", re.I),
    "confidence_interval": re.compile(r"\b\d+%\s*CI\s*[\[(\s]*\d+\.?\d*\s*[,–-]\s*\d+\.?\d*", re.I),
    "mean_sd": re.compile(r"\b[Mm]\s*=\s*\d+\.?\d*\s*,?\s*SD\s*=\s*\d+\.?\d*\b"),
    "percentage": re.compile(r"\b\d+\.?\d*\s*%"),
    "f_statistic": re.compile(r"\b[Ff]\s*\(\d+\s*,\s*\d+\)\s*=\s*\d+\.?\d*"),
    "t_statistic": re.compile(r"\b[Tt]\s*\(\d+\)\s*=\s*\d+\.?\d*"),
    "chi_square": re.compile(r"[χXx]²?\s*\(\d+\)\s*=\s*\d+\.?\d*"),
}


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


def _extract_numerical_evidence(text: str) -> list[dict]:
    findings: list[dict] = []
    for name, pattern in _STAT_PATTERNS.items():
        for m in pattern.finditer(text):
            findings.append({"type": name, "value": m.group(0)})
    return findings


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zA-Z]{3,}", text.lower())


def _build_idf(corpus_tokens: list[list[str]]) -> dict[str, float]:
    n_docs = max(len(corpus_tokens), 1)
    df: dict[str, int] = {}
    for toks in corpus_tokens:
        for t in set(toks):
            df[t] = df.get(t, 0) + 1
    return {t: math.log((1 + n_docs) / (1 + freq)) + 1.0 for t, freq in df.items()}


def _tfidf_cosine(tokens_a: list[str], tokens_b: list[str], idf: dict[str, float]) -> float:
    if not tokens_a or not tokens_b:
        return 0.0
    tf_a: dict[str, int] = {}
    tf_b: dict[str, int] = {}
    for t in tokens_a:
        tf_a[t] = tf_a.get(t, 0) + 1
    for t in tokens_b:
        tf_b[t] = tf_b.get(t, 0) + 1
    keys = set(tf_a) | set(tf_b)
    num = 0.0
    den_a = 0.0
    den_b = 0.0
    for k in keys:
        wa = tf_a.get(k, 0) * idf.get(k, 1.0)
        wb = tf_b.get(k, 0) * idf.get(k, 1.0)
        num += wa * wb
        den_a += wa * wa
        den_b += wb * wb
    if den_a <= 0 or den_b <= 0:
        return 0.0
    return num / (math.sqrt(den_a) * math.sqrt(den_b))


def _heuristic_labels(
    text_blocks: list[TextBlock],
    scheme: list[dict],
    evidences: list[EvidenceResult] | None = None,
) -> list[LabelResult]:
    full_text = " ".join(b.text.lower() for b in text_blocks)
    results = []
    supporting_map: dict[str, list[str]] = {}
    if evidences:
        for ev in evidences:
            for code_id in ev.relevant_code_ids:
                supporting_map.setdefault(code_id, []).append(ev.id)

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

        results.append(
            LabelResult(
                scheme_item_id=s["id"],
                value=value,
                confidence=score,
                supporting_evidence_ids=supporting_map.get(s["id"], [])[:12],
            )
        )
    return results


def _heuristic_evidences(text_blocks: list[TextBlock], scheme: list[dict]) -> list[EvidenceResult]:
    content_blocks = [b for b in text_blocks
                      if b.section not in ("references", "appendix", "acknowledgment")
                      and not _is_noise(b.text)]
    if not content_blocks:
        return []

    scheme_tokens = {s["id"]: _tokenize(f"{s.get('code', '')} {s.get('description', '')}") for s in scheme}
    corpus = [_tokenize(b.text) for b in content_blocks] + list(scheme_tokens.values())
    idf = _build_idf(corpus)
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
            "table": 0.45, "figure_caption": 0.35, "table_caption": 0.35,
        }.get(block.section, 0.1)

        block_tokens = _tokenize(text_lower)
        sim_scores = [(sid, _tfidf_cosine(block_tokens, toks, idf)) for sid, toks in scheme_tokens.items()]
        sim_scores.sort(key=lambda x: x[1], reverse=True)
        scheme_score = (sim_scores[0][1] if sim_scores else 0.0) * 0.7

        matched_codes: list[str] = []
        for sid, sim in sim_scores[:3]:
            if sim >= 0.12:
                matched_codes.append(sid)

        keyword_hits = 0
        for kw_list in all_kw_lists:
            keyword_hits += sum(1 for kw in kw_list if kw in text_lower)
        keyword_score = min(keyword_hits / 8, 1.0) * 0.3

        stats_found = _extract_numerical_evidence(block.text)
        stat_bonus = min(len(stats_found) / 4, 1.0) * 0.25
        total_score = section_bonus + scheme_score + keyword_score + length_bonus + stat_bonus

        if matched_codes or total_score > 0.5:
            if not matched_codes:
                best_scheme = max(scheme, key=lambda s: sum(
                    1 for w in re.findall(r"[a-zA-Z]{3,}", s["description"].lower()) if w in text_lower
                ))
                matched_codes = [best_scheme["id"]]
            scored.append((total_score, block, matched_codes))

    scored.sort(key=lambda x: x[0], reverse=True)

    evidences: list[EvidenceResult] = []
    for score, block, codes in scored:
        evidences.append(
            EvidenceResult(
                id=_gen_id(),
                text=block.text,
                page=block.page,
                bbox=block.bbox,
                relevant_code_ids=list(set(codes)),
                ai_reason="Heuristic match using section/TF-IDF/keywords/statistics.",
                confidence=round(min(max(score / 2.0, 0.3), 0.95), 2),
                extracted_stats=_extract_numerical_evidence(block.text),
                exact_quote=block.text[:250],
                evidence_type="statistical" if _extract_numerical_evidence(block.text) else "contextual",
            )
        )
    evidences = _deduplicate_evidences(evidences)
    return _apply_adaptive_evidence_limit(evidences, text_blocks, scheme)


def _jaccard(a: str, b: str) -> float:
    sa = set(_tokenize(a))
    sb = set(_tokenize(b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / max(len(sa | sb), 1)


def _deduplicate_evidences(evidences: list[EvidenceResult], threshold: float = 0.7) -> list[EvidenceResult]:
    deduped: list[EvidenceResult] = []
    for ev in sorted(evidences, key=lambda x: (-(x.confidence or 0.0), x.page)):
        merged = False
        for kept in deduped:
            if kept.page == ev.page and _jaccard(kept.text, ev.text) >= threshold:
                kept.relevant_code_ids = list(set((kept.relevant_code_ids or []) + (ev.relevant_code_ids or [])))
                kept.extracted_stats = list({json.dumps(x, sort_keys=True): x for x in (kept.extracted_stats or []) + (ev.extracted_stats or [])}.values())
                kept.bbox = {
                    "x": min(kept.bbox.get("x", 0), ev.bbox.get("x", 0)),
                    "y": min(kept.bbox.get("y", 0), ev.bbox.get("y", 0)),
                    "width": max(kept.bbox.get("x", 0) + kept.bbox.get("width", 0), ev.bbox.get("x", 0) + ev.bbox.get("width", 0)) - min(kept.bbox.get("x", 0), ev.bbox.get("x", 0)),
                    "height": max(kept.bbox.get("y", 0) + kept.bbox.get("height", 0), ev.bbox.get("y", 0) + ev.bbox.get("height", 0)) - min(kept.bbox.get("y", 0), ev.bbox.get("y", 0)),
                }
                merged = True
                break
        if not merged:
            deduped.append(ev)
    return deduped


def _apply_adaptive_evidence_limit(
    evidences: list[EvidenceResult],
    text_blocks: list[TextBlock],
    scheme: list[dict],
) -> list[EvidenceResult]:
    if not evidences:
        return []
    page_count = max((b.page for b in text_blocks), default=1)
    max_evidences = min(max(page_count * 3, 15), 50)
    per_page_limit = max(2, min(6, math.ceil(max_evidences / max(page_count, 1))))

    coverage_target = min(len(scheme), max_evidences)
    chosen: list[EvidenceResult] = []
    by_page: dict[int, int] = {}
    covered_codes: set[str] = set()

    ranked = sorted(evidences, key=lambda e: (-(e.confidence or 0.0), len(e.relevant_code_ids or []), -len(e.text)))
    for ev in ranked:
        if len(chosen) >= max_evidences:
            break
        if by_page.get(ev.page, 0) >= per_page_limit:
            continue
        chosen.append(ev)
        by_page[ev.page] = by_page.get(ev.page, 0) + 1
        covered_codes.update(ev.relevant_code_ids or [])

    if len(covered_codes) < coverage_target:
        missing = [s["id"] for s in scheme if s["id"] not in covered_codes]
        for code_id in missing:
            candidate = next((e for e in ranked if code_id in (e.relevant_code_ids or []) and e not in chosen), None)
            if candidate and len(chosen) < max_evidences:
                chosen.append(candidate)
    return chosen[:max_evidences]

"""Phase 2: RAG chat, synthesis, vision hints, active learning, RoB, snowballing, embeddings."""
from __future__ import annotations

import hashlib
import json
import logging
import math
import os
import re
import uuid
from typing import Any

from services.pdf_service import TextBlock

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None  # type: ignore

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_DEFAULT_MODEL = os.getenv("LLM_MODEL", "qwen-plus")
_VISION_MODEL = os.getenv("VISION_MODEL", "qwen-vl-plus")


def _client():
    key = os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key or not OpenAI:
        return None
    return OpenAI(api_key=key, base_url=os.getenv("LLM_BASE_URL", _DEFAULT_BASE_URL))


def _retrieve_blocks(question: str, text_blocks: list[TextBlock], top_k: int = 12) -> list[TextBlock]:
    q = question.lower().split()
    scored: list[tuple[float, TextBlock]] = []
    for b in text_blocks:
        t = b.text.lower()
        score = sum(1 for w in q if len(w) > 2 and w in t)
        score += min(len(t), 2000) * 0.0001
        scored.append((score, b))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [b for _, b in scored[:top_k]]


def rag_chat_answer(question: str, text_blocks: list[TextBlock], history: list[dict] | None = None) -> dict[str, Any]:
    """RAG: retrieve top blocks + LLM answer with citations to page/section."""
    ctx_blocks = _retrieve_blocks(question, text_blocks, top_k=14)
    context = "\n".join(f"[p.{b.page} {b.section}] {b.text[:1200]}" for b in ctx_blocks)
    client = _client()
    if not client:
        snippet = ctx_blocks[0].text[:400] if ctx_blocks else ""
        return {
            "answer": f"(Offline mode) Relevant excerpt: {snippet}...",
            "citations": [{"page": b.page, "section": b.section} for b in ctx_blocks[:3]],
        }
    messages: list[dict] = [
        {
            "role": "system",
            "content": "You are a research assistant. Answer ONLY using the provided paper excerpts. Cite page numbers in brackets like [p.3]. If unknown, say you cannot find it in the excerpts.",
        },
        {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {question}"},
    ]
    if history:
        for h in history[-6:]:
            if h.get("role") in ("user", "assistant") and h.get("content"):
                messages.insert(-1, {"role": h["role"], "content": h["content"]})
    try:
        resp = client.chat.completions.create(
            model=_DEFAULT_MODEL,
            messages=messages,
            temperature=0.2,
            max_tokens=1024,
        )
        text = resp.choices[0].message.content or ""
    except Exception as e:
        logger.exception("rag_chat")
        text = f"(Error calling model: {e})"
    return {
        "answer": text,
        "citations": [{"page": b.page, "section": b.section, "preview": b.text[:120]} for b in ctx_blocks[:5]],
    }


def cross_document_synthesis(
    scheme_code: str,
    scheme_description: str,
    passages: list[str],
) -> str:
    client = _client()
    joined = "\n---\n".join(passages[:40])
    if not client:
        return "Synthesis requires LLM API key. Passages collected: " + str(len(passages))
    prompt = (
        f"Coding theme: {scheme_code} — {scheme_description}\n\n"
        f"Synthesize findings across these excerpts. Note agreements, conflicts, and gaps.\n\n{joined}"
    )
    try:
        resp = client.chat.completions.create(
            model=_DEFAULT_MODEL,
            messages=[
                {"role": "system", "content": "You are a systematic review synthesizer. Be concise and academic."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=1500,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        return f"Synthesis error: {e}"


def extract_references_snowball(text: str, limit: int = 80) -> list[str]:
    """Heuristic reference lines from bibliography-like blocks."""
    refs: list[str] = []
    for line in text.splitlines():
        s = line.strip()
        if len(s) < 20:
            continue
        if re.match(r"^\[\d+\]", s) or re.match(r"^\d+\.\s+[A-Z]", s) or "doi.org" in s.lower():
            refs.append(s[:500])
        if len(refs) >= limit:
            break
    return refs


def risk_of_bias_llm(abstract_and_methods: str) -> dict[str, Any]:
    client = _client()
    if not client:
        return {"summary": "RoB requires LLM", "domains": {}}
    schema = (
        '{"summary": str, "domains": {"randomization": str, "deviations": str, '
        '"missing_data": str, "measurement": str, "selection": str}}'
    )
    try:
        resp = client.chat.completions.create(
            model=_DEFAULT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": f"Assess risk of bias (Cochrane RoB2-style hints). Return JSON only: {schema}",
                },
                {"role": "user", "content": abstract_and_methods[:12000]},
            ],
            temperature=0.1,
            max_tokens=800,
        )
        raw = resp.choices[0].message.content or "{}"
        return json.loads(raw.replace("```json", "").replace("```", "").strip())
    except Exception as e:
        return {"summary": str(e), "domains": {}}


def vision_describe_chart(png_bytes: bytes) -> str:
    """Vision LLM: describe figure/chart (requires multimodal model)."""
    client = _client()
    if not client:
        return "Vision requires LLM API key"
    import base64

    b64 = base64.standard_b64encode(png_bytes).decode("ascii")
    try:
        resp = client.chat.completions.create(
            model=_VISION_MODEL,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Describe this figure/table image for systematic review extraction: axes, effect sizes, p-values if visible."},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                    ],
                }
            ],
            max_tokens=600,
        )
        return resp.choices[0].message.content or ""
    except Exception as e:
        logger.warning("vision_describe_chart: %s", e)
        return f"Vision model error (try setting VISION_MODEL): {e}"


def pseudo_embedding(text: str, dim: int = 64) -> list[float]:
    """Deterministic pseudo-embedding when OpenAI embeddings unavailable."""
    h = hashlib.sha256(text.encode("utf-8", errors="ignore")).digest()
    vec = [((h[i % len(h)] / 255.0) - 0.5) * 2 for i in range(dim)]
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def embedding_openai(text: str) -> list[float] | None:
    client = _client()
    if not client:
        return None
    try:
        emb_model = os.getenv("EMBEDDING_MODEL", "text-embedding-v3")
        r = client.embeddings.create(model=emb_model, input=text[:8000])
        return list(r.data[0].embedding)
    except Exception:
        return None


def embed_text(text: str) -> list[float]:
    return embedding_openai(text) or pseudo_embedding(text)


def cosine_sim(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def vector_search_chunks(query: str, chunks: list[tuple[str, list[float], dict]], top_k: int = 8) -> list[dict]:
    qv = embed_text(query)
    scored: list[tuple[float, dict]] = []
    for text, emb, meta in chunks:
        if emb and len(emb) == len(qv):
            s = cosine_sim(qv, emb)
        else:
            s = cosine_sim(qv, embed_text(text))
        scored.append((s, {"text": text[:500], **meta, "score": s}))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored[:top_k]]


def active_learning_snippets(settings: dict | None, limit: int = 4) -> str:
    ex = (settings or {}).get("feedback_examples") or []
    if not ex:
        return ""
    lines = []
    for e in ex[-limit:]:
        lines.append(f"User said {e.get('response')} for: {e.get('text', '')[:200]}")
    return "Prior user feedback examples:\n" + "\n".join(lines)

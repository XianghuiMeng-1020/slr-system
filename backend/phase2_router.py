"""Phase 2 API: auth, RAG chat, synthesis, vision, vector search, collaboration, external APIs."""
from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any, Optional
from urllib.parse import quote

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth_jwt import create_access_token, get_current_user, get_current_user_optional, hash_password, verify_password
from database import get_db
from models import (
    AuditLog,
    CodingSchemeItem,
    Document,
    DocumentChunk,
    DocumentLabel,
    Evidence,
    EvidenceComment,
    Project,
    ProjectMember,
    User,
)
from services import file_service, notion_export, pdf_service, qdrant_store, zotero_oauth
from services.pdf_service import TextBlock
from services.export_service import export_nvivo_xml, export_results_docx_draft
from services.phase2_core import (
    active_learning_snippets,
    cross_document_synthesis,
    embed_text,
    extract_references_snowball,
    rag_chat_answer,
    risk_of_bias_llm,
    vector_search_chunks,
    vision_describe_chart,
)
from storage_s3 import presign_get, s3_enabled

logger = logging.getLogger(__name__)

router = APIRouter()
_ws_clients: dict[str, list[WebSocket]] = {}
_broadcast_loop: asyncio.AbstractEventLoop | None = None


def set_broadcast_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _broadcast_loop
    _broadcast_loop = loop


def _ok(data=None, message: str = "ok"):
    return {"data": data, "message": message}


def _audit(db: Session, project_id: str, action: str, detail: dict | None = None, user_id: str | None = None):
    db.add(
        AuditLog(
            id=uuid.uuid4().hex[:16],
            project_id=project_id,
            user_id=user_id,
            action=action,
            detail_json=detail or {},
        )
    )


# --- Auth ---


class RegisterReq(BaseModel):
    email: str = Field(..., min_length=3)
    password: str = Field(..., min_length=6)


class LoginReq(BaseModel):
    email: str
    password: str


@router.post("/api/auth/register")
def register(req: RegisterReq, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(400, "Email already registered")
    user = User(
        id=uuid.uuid4().hex[:12],
        email=req.email,
        password_hash=hash_password(req.password),
        role="reviewer",
    )
    db.add(user)
    db.commit()
    token = create_access_token(user.id, user.email)
    return _ok({"token": token, "user": {"id": user.id, "email": user.email}})


@router.post("/api/auth/login")
def login(req: LoginReq, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == req.email).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    token = create_access_token(user.id, user.email)
    return _ok({"token": token, "user": {"id": user.id, "email": user.email}})


@router.get("/api/auth/me")
def me(user: User = Depends(get_current_user)):
    return _ok({"id": user.id, "email": user.email, "role": user.role})


# --- Project settings & active learning ---


class ProjectSettingsReq(BaseModel):
    custom_system_prompt: Optional[str] = None
    dual_coding_blind: Optional[bool] = None
    notion_webhook_url: Optional[str] = None
    notion_integration_secret: Optional[str] = None
    notion_parent_page_id: Optional[str] = None


@router.get("/api/projects/{project_id}/settings")
def get_project_settings(project_id: str, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    return _ok(p.settings_json or {})


@router.put("/api/projects/{project_id}/settings")
def put_project_settings(
    project_id: str,
    req: ProjectSettingsReq,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    s = dict(p.settings_json or {})
    if req.custom_system_prompt is not None:
        s["custom_system_prompt"] = req.custom_system_prompt
    if req.dual_coding_blind is not None:
        s["dual_coding_blind"] = req.dual_coding_blind
    if req.notion_webhook_url is not None:
        s["notion_webhook_url"] = req.notion_webhook_url
    if req.notion_integration_secret is not None:
        s["notion_integration_secret"] = req.notion_integration_secret
    if req.notion_parent_page_id is not None:
        s["notion_parent_page_id"] = req.notion_parent_page_id
    p.settings_json = s
    _audit(db, project_id, "settings_updated", s, user.id if user else None)
    db.commit()
    return _ok(s)


class FeedbackReq(BaseModel):
    evidence_id: str
    document_id: str
    response: str
    text_preview: str


@router.post("/api/projects/{project_id}/active-learning/feedback")
def active_learning_feedback(project_id: str, req: FeedbackReq, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    s = dict(p.settings_json or {})
    ex = list(s.get("feedback_examples") or [])
    ex.append({"evidence_id": req.evidence_id, "response": req.response, "text": req.text_preview[:400]})
    s["feedback_examples"] = ex[-50:]
    p.settings_json = s
    db.commit()
    return _ok({"stored": len(ex), "hint": active_learning_snippets(s)})


# --- RAG Chat ---


class ChatReq(BaseModel):
    question: str
    history: list[dict] = []


@router.post("/api/projects/{project_id}/documents/{doc_id}/chat")
def document_chat(
    project_id: str,
    doc_id: str,
    req: ChatReq,
    db: Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.text_blocks_cache:
        blocks = [pdf_service.TextBlock.from_dict(x) for x in (doc.text_blocks_cache or [])]
    elif doc.file_path and os.path.exists(doc.file_path):
        blocks = pdf_service.extract_text_blocks(doc.file_path)
    else:
        raise HTTPException(400, "No text for document")
    out = rag_chat_answer(req.question, blocks, req.history)
    return _ok(out)


# --- Cross-document synthesis ---


class SynthReq(BaseModel):
    scheme_item_id: str


@router.post("/api/projects/{project_id}/synthesis")
def project_synthesis(project_id: str, req: SynthReq, db: Session = Depends(get_db)):
    scheme = db.query(CodingSchemeItem).filter(
        CodingSchemeItem.id == req.scheme_item_id,
        CodingSchemeItem.project_id == project_id,
    ).first()
    if not scheme:
        raise HTTPException(404, "Scheme item not found")
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    passages: list[str] = []
    for d in docs:
        for ev in db.query(Evidence).filter(Evidence.document_id == d.id).all():
            if req.scheme_item_id in (ev.relevant_code_ids or []):
                passages.append(f"[{d.filename} p.{ev.page}] {ev.text[:600]}")
    text = cross_document_synthesis(scheme.code, scheme.description, passages)
    return _ok({"synthesis": text, "passages_used": len(passages)})


# --- Vision (render PDF page to PNG) ---


@router.post("/api/projects/{project_id}/documents/{doc_id}/vision/page")
def vision_page(
    project_id: str,
    doc_id: str,
    page: int = Query(1, ge=1),
    db: Session = Depends(get_db),
):
    import fitz

    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc or not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(404, "Document not found")
    pdf = fitz.open(doc.file_path)
    if page > pdf.page_count:
        pdf.close()
        raise HTTPException(400, "Invalid page")
    p = pdf[page - 1]
    pix = p.get_pixmap(matrix=fitz.Matrix(2, 2))
    png = pix.tobytes("png")
    pdf.close()
    desc = vision_describe_chart(png)
    return _ok({"page": page, "description": desc})


# --- RoB & Snowballing ---


@router.post("/api/projects/{project_id}/documents/{doc_id}/risk-of-bias")
def risk_of_bias(project_id: str, doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.text_blocks_cache:
        blocks = [pdf_service.TextBlock.from_dict(x) for x in (doc.text_blocks_cache or [])]
    elif doc.file_path:
        blocks = pdf_service.extract_text_blocks(doc.file_path)
    else:
        raise HTTPException(400, "No text")
    intro = "\n".join(b.text for b in blocks if b.section in ("abstract", "method", "methods", "introduction"))[:15000]
    return _ok(risk_of_bias_llm(intro))


@router.get("/api/projects/{project_id}/documents/{doc_id}/references")
def snowball_refs(project_id: str, doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.text_blocks_cache:
        full = "\n".join(x.get("text", "") for x in (doc.text_blocks_cache or []))
    elif doc.file_path:
        full = "\n".join(b.text for b in pdf_service.extract_text_blocks(doc.file_path))
    else:
        raise HTTPException(400, "No text")
    refs = extract_references_snowball(full)
    return _ok({"references": refs, "count": len(refs)})


# --- Deduplication ---


@router.post("/api/projects/{project_id}/deduplicate")
def deduplicate(project_id: str, db: Session = Depends(get_db)):
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    seen: dict[str, str] = {}
    removed = []
    for d in docs:
        key = (d.doi or "").strip().lower() or (d.title or d.filename or "").lower()[:200]
        if not key:
            continue
        if key in seen:
            removed.append({"id": d.id, "duplicate_of": seen[key]})
        else:
            seen[key] = d.id
    return _ok({"potential_duplicates": removed})


# --- External: PubMed, CrossRef, arXiv, optional Scopus/IEEE ---


def _cohen_kappa(a: list[str], b: list[str]) -> float | None:
    if len(a) != len(b) or not a:
        return None
    n = len(a)
    cats = sorted(set(a) | set(b))
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    pe = sum((sum(1 for x in a if x == c) / n) * (sum(1 for y in b if y == c) / n) for c in cats)
    if abs(1 - pe) < 1e-9:
        return 1.0 if po >= 1.0 - 1e-9 else 0.0
    return (po - pe) / (1 - pe)


@router.get("/api/external/pubmed")
async def pubmed_search(q: str = Query(..., min_length=2), retmax: int = Query(10, ge=1, le=50)):
    url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
    params = {"db": "pubmed", "term": q, "retmode": "json", "retmax": retmax}
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()
    ids = data.get("esearchresult", {}).get("idlist", [])
    return _ok({"ids": ids})


@router.get("/api/external/crossref")
async def crossref_meta(doi: str = Query(..., description="DOI e.g. 10.1038/nature12373")):
    from urllib.parse import quote

    url = f"https://api.crossref.org/works/{quote(doi)}"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(r.status_code, "Crossref lookup failed")
        return _ok(r.json().get("message", {}))


@router.get("/api/external/arxiv")
async def arxiv_search(q: str = Query(..., min_length=2), max_results: int = Query(10, ge=1, le=30)):
    """Search arXiv Atom API (no API key)."""
    import xml.etree.ElementTree as ET

    url = "http://export.arxiv.org/api/query"
    async with httpx.AsyncClient(timeout=40.0) as client:
        r = await client.get(url, params={"search_query": f"all:{q}", "start": 0, "max_results": max_results})
        r.raise_for_status()
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(r.text)
    out: list[dict[str, str]] = []
    for e in root.findall("atom:entry", ns):
        id_el = e.find("atom:id", ns)
        title_el = e.find("atom:title", ns)
        published = e.find("atom:published", ns)
        summary_el = e.find("atom:summary", ns)
        aid = (id_el.text or "").strip() if id_el is not None else ""
        title = (title_el.text or "").strip().replace("\n", " ") if title_el is not None else ""
        summ = (summary_el.text or "").strip().replace("\n", " ")[:400] if summary_el is not None else ""
        pub = (published.text or "").strip()[:10] if published is not None else ""
        if aid:
            out.append({"id": aid, "title": title, "published": pub, "summary": summ})
    return _ok({"entries": out})


@router.get("/api/external/scopus")
async def scopus_search(q: str = Query(..., min_length=2), count: int = Query(10, ge=1, le=25)):
    key = os.getenv("SCOPUS_API_KEY")
    if not key:
        return _ok(
            {
                "items": [],
                "note": "Elsevier Scopus API requires SCOPUS_API_KEY; register at dev.elsevier.com.",
            }
        )
    url = "https://api.elsevier.com/content/search/scopus"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(
            url,
            params={"query": q, "count": count},
            headers={"X-ELS-APIKey": key, "Accept": "application/json"},
        )
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text[:500])
    data = r.json()
    items = []
    raw_entries = (data.get("search-results", {}) or {}).get("entry", []) or []
    if isinstance(raw_entries, dict):
        raw_entries = [raw_entries]
    for e in raw_entries:
        items.append(
            {
                "title": e.get("dc:title", ""),
                "doi": e.get("prism:doi", ""),
                "eid": e.get("eid", ""),
            }
        )
    return _ok({"items": items})


@router.get("/api/external/ieee")
async def ieee_search(q: str = Query(..., min_length=2), max_records: int = Query(10, ge=1, le=25)):
    key = os.getenv("IEEE_XPLOR_API_KEY")
    if not key:
        return _ok(
            {
                "articles": [],
                "note": "IEEE Xplore requires IEEE_XPLOR_API_KEY (developer.ieee.org).",
            }
        )
    url = "https://ieeexploreapi.ieee.org/api/v1/search/articles"
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, params={"querytext": q, "max_records": max_records, "apikey": key})
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text[:500])
    return _ok(r.json())


# --- Docx / HTML pseudo-import (stores as text-only document record) ---


@router.post("/api/projects/{project_id}/import-text")
async def import_text(
    project_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    fname = (file.filename or "paste.txt").lower()
    raw = await file.read()
    text = ""
    tmp = os.path.join(os.path.dirname(__file__), "data", "uploads", project_id)
    os.makedirs(tmp, exist_ok=True)
    path = os.path.join(tmp, f"{uuid.uuid4().hex[:8]}_{file.filename or 'import'}")
    with open(path, "wb") as f:
        f.write(raw)
    if fname.endswith(".docx"):
        text = file_service.extract_docx_text(path)
    elif fname.endswith(".html") or fname.endswith(".htm"):
        text = file_service.extract_html_text(raw.decode("utf-8", errors="ignore"))
    else:
        text = raw.decode("utf-8", errors="ignore")
    tb = TextBlock(text=text[:50000], page=1, bbox={"x": 0, "y": 0, "width": 0, "height": 0}, section="body", kind="paragraph")
    doc = Document(
        id=uuid.uuid4().hex[:12],
        project_id=project_id,
        filename=file.filename or "import.txt",
        page_count=1,
        status="completed",
        file_path=None,
        text_blocks_cache=[tb.to_dict()],
    )
    db.add(doc)
    db.commit()
    return _ok({"id": doc.id, "preview": text[:500]})


# --- Embeddings & vector search ---


@router.post("/api/projects/{project_id}/index-embeddings")
def index_embeddings(project_id: str, db: Session = Depends(get_db)):
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(404, "Project not found")
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    n = 0
    qdrant_points: list[dict[str, Any]] = []
    if qdrant_store.qdrant_enabled():
        qdrant_store.delete_collection(qdrant_store.collection_name(project_id))
    for d in docs:
        db.query(DocumentChunk).filter(DocumentChunk.document_id == d.id).delete()
        if not d.text_blocks_cache:
            continue
        for i, blk in enumerate(d.text_blocks_cache[:200]):
            t = blk.get("text") if isinstance(blk, dict) else str(blk)
            if not t or len(t) < 20:
                continue
            emb = embed_text(t[:2000])
            cid = uuid.uuid4().hex[:16]
            db.add(
                DocumentChunk(
                    id=cid,
                    document_id=d.id,
                    chunk_index=i,
                    text=t[:4000],
                    embedding=emb,
                )
            )
            n += 1
            if qdrant_store.qdrant_enabled():
                qdrant_points.append(
                    {
                        "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"{project_id}:{cid}")),
                        "vector": emb,
                        "payload": {"text": t[:4000], "document_id": d.id, "chunk_id": cid},
                    }
                )
    db.commit()
    qn = 0
    if qdrant_points:
        qn = qdrant_store.upsert_project_chunks(project_id, qdrant_points)
    return _ok({"chunks_indexed": n, "qdrant_upserted": qn, "qdrant_enabled": qdrant_store.qdrant_enabled()})


class VectorSearchReq(BaseModel):
    query: str
    top_k: int = 8


@router.post("/api/projects/{project_id}/vector-search")
def vector_search_api(project_id: str, req: VectorSearchReq, db: Session = Depends(get_db)):
    qv = embed_text(req.query)
    if qdrant_store.qdrant_enabled():
        qh = qdrant_store.search_project(project_id, qv, top_k=req.top_k)
        if qh:
            return _ok({"hits": qh, "backend": "qdrant"})
    chunks = (
        db.query(DocumentChunk)
        .join(Document, Document.id == DocumentChunk.document_id)
        .filter(Document.project_id == project_id)
        .all()
    )
    triples: list[tuple[str, list[float], dict]] = []
    for c in chunks:
        emb = c.embedding or embed_text(c.text)
        triples.append((c.text, emb, {"document_id": c.document_id, "chunk_id": c.id}))
    hits = vector_search_chunks(req.query, triples, top_k=req.top_k)
    return _ok({"hits": hits, "backend": "sqlite"})


# --- Comments & audit ---


class CommentReq(BaseModel):
    body: str
    mentions: list[str] = []


@router.post("/api/projects/{project_id}/evidences/{evidence_id}/comments")
def add_comment(
    project_id: str,
    evidence_id: str,
    req: CommentReq,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    ev = (
        db.query(Evidence)
        .join(Document, Document.id == Evidence.document_id)
        .filter(Evidence.id == evidence_id, Document.project_id == project_id)
        .first()
    )
    if not ev:
        raise HTTPException(404, "Evidence not found")
    c = EvidenceComment(
        id=uuid.uuid4().hex[:12],
        evidence_id=evidence_id,
        user_id=user.id if user else None,
        body=req.body,
        mentions=req.mentions,
    )
    db.add(c)
    _audit(db, project_id, "comment_added", {"evidence_id": evidence_id}, user.id if user else None)
    db.commit()
    return _ok({"id": c.id})


@router.get("/api/projects/{project_id}/audit")
def audit_log(project_id: str, db: Session = Depends(get_db)):
    rows = db.query(AuditLog).filter(AuditLog.project_id == project_id).order_by(AuditLog.created_at.desc()).limit(200).all()
    return _ok(
        [
            {"id": r.id, "action": r.action, "detail": r.detail_json, "user_id": r.user_id, "created_at": r.created_at.isoformat() if r.created_at else None}
            for r in rows
        ]
    )


# --- IRR & conflicts ---


@router.get("/api/projects/{project_id}/irr")
def irr_report(project_id: str, db: Session = Depends(get_db)):
    """Inter-rater reliability when labels have reviewer_id set."""
    labels = (
        db.query(DocumentLabel)
        .join(Document, Document.id == DocumentLabel.document_id)
        .filter(Document.project_id == project_id, DocumentLabel.reviewer_id.isnot(None))
        .all()
    )
    reviewers = list({lb.reviewer_id for lb in labels if lb.reviewer_id})
    if len(reviewers) < 2:
        return _ok({"kappa": None, "percent_agreement": None, "note": "Need at least two distinct reviewer_id values on labels"})
    r1, r2 = reviewers[0], reviewers[1]
    a_vals: list[str] = []
    b_vals: list[str] = []
    for doc in db.query(Document).filter(Document.project_id == project_id).all():
        for s in db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all():
            l1 = (
                db.query(DocumentLabel)
                .filter(
                    DocumentLabel.document_id == doc.id,
                    DocumentLabel.scheme_item_id == s.id,
                    DocumentLabel.reviewer_id == r1,
                )
                .first()
            )
            l2 = (
                db.query(DocumentLabel)
                .filter(
                    DocumentLabel.document_id == doc.id,
                    DocumentLabel.scheme_item_id == s.id,
                    DocumentLabel.reviewer_id == r2,
                )
                .first()
            )
            if l1 and l2:
                a_vals.append(l1.user_override or l1.value)
                b_vals.append(l2.user_override or l2.value)
    if not a_vals:
        return _ok({"kappa": None, "pairs": 0})
    pa = sum(1 for x, y in zip(a_vals, b_vals) if x == y) / len(a_vals)
    kappa = _cohen_kappa(a_vals, b_vals)
    return _ok(
        {
            "percent_agreement": round(pa, 4),
            "cohens_kappa": round(kappa, 4) if kappa is not None else None,
            "pairs": len(a_vals),
            "reviewers": [r1, r2],
        }
    )


@router.get("/api/projects/{project_id}/conflicts")
def conflicts(project_id: str, db: Session = Depends(get_db)):
    reviewers = list(
        {
            lb.reviewer_id
            for lb in db.query(DocumentLabel)
            .join(Document, Document.id == DocumentLabel.document_id)
            .filter(Document.project_id == project_id, DocumentLabel.reviewer_id.isnot(None))
            .all()
            if lb.reviewer_id
        }
    )
    if len(reviewers) < 2:
        return _ok({"conflicts": []})
    r1, r2 = reviewers[0], reviewers[1]
    out = []
    for doc in db.query(Document).filter(Document.project_id == project_id).all():
        for s in db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all():
            l1 = (
                db.query(DocumentLabel)
                .filter(
                    DocumentLabel.document_id == doc.id,
                    DocumentLabel.scheme_item_id == s.id,
                    DocumentLabel.reviewer_id == r1,
                )
                .first()
            )
            l2 = (
                db.query(DocumentLabel)
                .filter(
                    DocumentLabel.document_id == doc.id,
                    DocumentLabel.scheme_item_id == s.id,
                    DocumentLabel.reviewer_id == r2,
                )
                .first()
            )
            if l1 and l2 and (l1.user_override or l1.value) != (l2.user_override or l2.value):
                out.append(
                    {
                        "document_id": doc.id,
                        "filename": doc.filename,
                        "scheme_item_id": s.id,
                        "code": s.code,
                        "reviewer_a": l1.user_override or l1.value,
                        "reviewer_b": l2.user_override or l2.value,
                    }
                )
    return _ok({"conflicts": out})


# --- Project members ---


@router.post("/api/projects/{project_id}/members")
def add_member(
    project_id: str,
    email: str = Query(...),
    db: Session = Depends(get_db),
    admin: User = Depends(get_current_user),
):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(404, "User not found; they must register first")
    if not db.query(Project).filter(Project.id == project_id).first():
        raise HTTPException(404, "Project not found")
    if db.query(ProjectMember).filter(ProjectMember.project_id == project_id, ProjectMember.user_id == user.id).first():
        return _ok({"status": "already_member"})
    db.add(ProjectMember(id=uuid.uuid4().hex[:12], project_id=project_id, user_id=user.id, role="reviewer"))
    db.commit()
    return _ok({"status": "added"})


# --- Zotero (API Key mode + OAuth 1.0a fallback) ---


class ZoteroImportReq(BaseModel):
    limit: int = 20


class ZoteroApiKeyReq(BaseModel):
    api_key: str
    project_id: Optional[str] = None


@router.post("/api/integrations/zotero/connect-apikey")
def zotero_connect_apikey(
    req: ZoteroApiKeyReq,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    """Verify a Zotero personal API key and store it in project settings (no auth required)."""
    try:
        info = zotero_oauth.verify_apikey(req.api_key)
    except Exception as e:
        raise HTTPException(400, f"API key verification failed: {e}")

    if req.project_id:
        p = db.query(Project).filter(Project.id == req.project_id).first()
        if p:
            s = dict(p.settings_json or {})
            s["zotero_api_key"] = req.api_key
            s["zotero_user_id"] = info["userID"]
            s["zotero_username"] = info.get("username", "")
            p.settings_json = s
            db.commit()

    if user:
        u = db.query(User).filter(User.id == user.id).first()
        if u:
            oj = dict(u.oauth_json or {})
            oj["zotero"] = {
                "api_key": req.api_key,
                "userID": info["userID"],
                "username": info.get("username", ""),
            }
            u.oauth_json = oj
            db.commit()

    return _ok({"connected": True, "userID": info["userID"], "username": info.get("username", "")})


@router.post("/api/integrations/zotero/authorize")
def zotero_authorize(user: User = Depends(get_current_user)):
    if not zotero_oauth.oauth_available():
        raise HTTPException(400, "OAuth not configured. Use API Key mode instead (paste your key in Settings).")
    try:
        out = zotero_oauth.start_authorization(user.id)
        return _ok(out)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        logger.exception("zotero_authorize")
        raise HTTPException(502, str(e))


@router.get("/api/integrations/zotero/callback")
def zotero_callback(
    oauth_token: str = Query(...),
    oauth_verifier: str = Query(...),
    db: Session = Depends(get_db),
):
    redir = os.getenv("ZOTERO_FRONTEND_REDIRECT", "http://localhost:5173/settings")
    try:
        slr_uid, access = zotero_oauth.complete_authorization(oauth_token, oauth_verifier)
    except Exception as e:
        return RedirectResponse(f"{redir}?zotero=error&reason={quote(str(e)[:220])}")
    u = db.query(User).filter(User.id == slr_uid).first()
    if u:
        oj = dict(u.oauth_json or {})
        oj["zotero"] = access
        u.oauth_json = oj
        db.commit()
    return RedirectResponse(f"{redir}?zotero=connected")


@router.get("/api/integrations/zotero/status")
def zotero_status(
    project_id: Optional[str] = None,
    user: Optional[User] = Depends(get_current_user_optional),
    db: Session = Depends(get_db),
):
    z = None
    if user:
        u = db.query(User).filter(User.id == user.id).first()
        z = (u.oauth_json or {}).get("zotero") if u and u.oauth_json else None

    if not z and project_id:
        p = db.query(Project).filter(Project.id == project_id).first()
        if p and p.settings_json:
            s = p.settings_json
            if s.get("zotero_api_key"):
                z = {
                    "api_key": s["zotero_api_key"],
                    "userID": s.get("zotero_user_id"),
                    "username": s.get("zotero_username"),
                }

    connected = bool(z and (z.get("api_key") or z.get("oauth_token")))
    mode = "apikey" if (z or {}).get("api_key") else ("oauth" if (z or {}).get("oauth_token") else None)
    return _ok(
        {
            "connected": connected,
            "mode": mode,
            "username": (z or {}).get("username"),
            "userID": (z or {}).get("userID"),
        }
    )


@router.post("/api/projects/{project_id}/integrations/zotero/import")
def zotero_import_items(
    project_id: str,
    req: ZoteroImportReq,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")

    z = None
    if user:
        u = db.query(User).filter(User.id == user.id).first()
        z = (u.oauth_json or {}).get("zotero") if u and u.oauth_json else None

    if not z and p.settings_json:
        s = p.settings_json
        if s.get("zotero_api_key"):
            z = {
                "api_key": s["zotero_api_key"],
                "userID": s.get("zotero_user_id"),
                "username": s.get("zotero_username"),
            }

    if not z:
        raise HTTPException(400, "Connect Zotero first (paste API Key in Settings)")

    if z.get("api_key"):
        items = zotero_oauth.fetch_top_items_apikey(
            z["api_key"], str(z["userID"]), limit=min(req.limit, 50)
        )
    elif z.get("oauth_token"):
        items = zotero_oauth.fetch_top_items(z, limit=min(req.limit, 50))
    else:
        raise HTTPException(400, "Connect Zotero first")

    created: list[dict[str, str]] = []
    for it in items:
        data = it.get("data", it)
        key = str(data.get("key") or uuid.uuid4().hex[:8])
        title = (data.get("title") or "Untitled")[:500]
        doc = Document(
            id=uuid.uuid4().hex[:12],
            project_id=project_id,
            filename=f"zotero_{key}.md",
            page_count=1,
            status="pending",
            file_path=None,
            title=title,
            metadata_json={"source": "zotero", "item": data},
        )
        db.add(doc)
        created.append({"id": doc.id, "title": title})
    db.commit()
    return _ok({"imported": len(created), "items": created})


# --- Notion webhook ---


class NotionPayload(BaseModel):
    project_id: str
    event: str
    payload: dict = {}


@router.post("/api/webhooks/notion")
def notion_webhook_inbound(req: NotionPayload, db: Session = Depends(get_db)):
    p = db.query(Project).filter(Project.id == req.project_id).first()
    if p:
        _audit(db, req.project_id, "notion_webhook_inbound", {"event": req.event, "payload": req.payload})
        db.commit()
    return _ok({"received": True})


# --- Export Phase 2 ---


@router.get("/api/projects/{project_id}/export/docx-draft")
def export_docx(project_id: str, db: Session = Depends(get_db)):
    data = export_results_docx_draft(db, project_id)
    from fastapi.responses import Response

    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename=slr_results_{project_id}.docx"},
    )


@router.get("/api/projects/{project_id}/export/nvivo")
def export_nvivo(project_id: str, db: Session = Depends(get_db)):
    xml = export_nvivo_xml(db, project_id)
    from fastapi.responses import Response

    return Response(
        content=xml,
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename=slr_{project_id}.xml"},
    )


class NotionExportReq(BaseModel):
    title: Optional[str] = None


@router.post("/api/projects/{project_id}/export/notion-page")
def export_notion_page(
    project_id: str,
    req: NotionExportReq,
    db: Session = Depends(get_db),
):
    p = db.query(Project).filter(Project.id == project_id).first()
    if not p:
        raise HTTPException(404, "Project not found")
    s = dict(p.settings_json or {})
    secret = s.get("notion_integration_secret") or os.getenv("NOTION_INTEGRATION_SECRET", "").strip()
    parent = s.get("notion_parent_page_id") or os.getenv("NOTION_PARENT_PAGE_ID", "").strip()
    if not secret or not parent:
        raise HTTPException(
            400,
            "Set notion_integration_secret and notion_parent_page_id in project settings (or NOTION_* env vars).",
        )
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    ev_n = db.query(Evidence).join(Document, Document.id == Evidence.document_id).filter(Document.project_id == project_id).count()
    lines = [
        f"Project ID: {project_id}",
        f"Documents: {len(docs)} (completed: {sum(1 for d in docs if d.status == 'completed')})",
        f"Evidence rows (approx): {ev_n}",
    ]
    title = req.title or f"SLR snapshot {project_id[:8]}"
    page = notion_export.create_page_with_blocks(secret, parent, title, lines)
    return _ok({"page": page, "notion_page_id": page.get("id")})


@router.post("/api/projects/{project_id}/process/celery")
def process_project_celery(project_id: str, db: Session = Depends(get_db)):
    """Queue each pending document as a separate Celery task (requires broker + worker)."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    scheme_items = db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all()
    if not scheme_items:
        raise HTTPException(400, "No coding scheme uploaded")
    documents = db.query(Document).filter(
        Document.project_id == project_id,
        Document.status.in_(["pending", "error"]),
    ).all()
    if not documents:
        return _ok({"queued": 0, "hint": "No pending documents"})
    try:
        from celery_app import process_document_task
    except ImportError as e:
        raise HTTPException(500, f"Celery not available: {e}") from e
    n = 0
    for d in documents:
        process_document_task.delay(d.id, project_id)
        n += 1
    return _ok({"queued": n, "note": "Start worker: celery -A celery_app worker -l info"})


# --- S3 status ---


@router.get("/api/system/storage")
def storage_status():
    return _ok({"s3_enabled": s3_enabled(), "hint": "Set S3_BUCKET and AWS_ACCESS_KEY_ID for R2/S3"})


@router.get("/api/system/vector-backend")
def vector_backend_status():
    return _ok(
        {
            "qdrant_configured": qdrant_store.qdrant_enabled(),
            "qdrant_url": os.getenv("QDRANT_URL", ""),
            "hint": "Set QDRANT_URL (e.g. http://127.0.0.1:6333) and run index-embeddings to upsert vectors.",
        }
    )


# --- WebSocket ---


@router.websocket("/ws/project/{project_id}")
async def ws_project(websocket: WebSocket, project_id: str):
    await websocket.accept()
    _ws_clients.setdefault(project_id, []).append(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            for ws in _ws_clients.get(project_id, []):
                if ws != websocket:
                    await ws.send_text(data)
    except WebSocketDisconnect:
        _ws_clients[project_id] = [w for w in _ws_clients.get(project_id, []) if w != websocket]


def broadcast_project(project_id: str, message: dict):
    """Broadcast JSON to all WebSocket clients (best-effort, fire-and-forget)."""
    import json as _json

    txt = _json.dumps(message)

    async def _send_all() -> None:
        for ws in list(_ws_clients.get(project_id, [])):
            try:
                await ws.send_text(txt)
            except Exception:
                pass

    loop = _broadcast_loop
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(_send_all(), loop)
    else:
        try:
            asyncio.run(_send_all())
        except RuntimeError:
            logger.debug("broadcast skipped (no event loop)")

import os
import uuid
import shutil
import logging
import shutil as _shutil
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from database import engine, get_db, Base, SessionLocal
from models import Project, Document, CodingSchemeItem, DocumentLabel, Evidence
from services import pdf_service, ai_service, file_service, export_service

load_dotenv()
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("slr-system")

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SLR System API", version="1.0.0")

_cors_origins = [
    "http://localhost:5173",
    "http://localhost:3000",
]
_extra_origins = os.getenv("CORS_ORIGINS", "")
if _extra_origins:
    _cors_origins.extend([o.strip() for o in _extra_origins.split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
UPLOAD_DIR = os.path.join(DATA_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "50"))
MAX_SCHEME_ITEMS = int(os.getenv("MAX_SCHEME_ITEMS", "200"))
_PROCESS_TASKS: dict[str, dict] = {}


def _ok(data=None, message: str = "ok"):
    return {"data": data, "message": message}


def _migrate_sqlite_schema():
    """Lightweight migration for evolving schema without Alembic."""
    with engine.begin() as conn:
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_documents_project_id ON documents (project_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_coding_scheme_items_project_id ON coding_scheme_items (project_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_labels_document_id ON document_labels (document_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_labels_scheme_item_id ON document_labels (scheme_item_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_document_labels_document_scheme ON document_labels (document_id, scheme_item_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS ix_evidences_document_id ON evidences (document_id)"))

        # SQLite supports IF NOT EXISTS for ADD COLUMN only in newer versions inconsistently, so guard manually.
        def ensure_col(table: str, col: str, ddl: str):
            cols = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
            names = {c[1] for c in cols}
            if col not in names:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {ddl}"))

        ensure_col("documents", "error_message", "error_message TEXT")
        ensure_col("documents", "text_blocks_cache", "text_blocks_cache JSON")
        ensure_col("document_labels", "supporting_evidence_ids", "supporting_evidence_ids JSON")
        ensure_col("evidences", "extracted_stats", "extracted_stats JSON")
        ensure_col("evidences", "ai_reason", "ai_reason TEXT")
        ensure_col("evidences", "exact_quote", "exact_quote TEXT")
        ensure_col("evidences", "evidence_type", "evidence_type VARCHAR")
        ensure_col("evidences", "confidence", "confidence FLOAT")


_migrate_sqlite_schema()


# ---------- Schemas ----------

class CreateProjectReq(BaseModel):
    mode: Literal["theme-verification", "evidence-verification"]

class ProjectRes(BaseModel):
    id: str
    mode: Literal["theme-verification", "evidence-verification"]

class DocumentRes(BaseModel):
    id: str
    filename: str
    page_count: int
    status: str
    error_message: Optional[str] = None

class SchemeItemRes(BaseModel):
    id: str
    code: str
    description: str
    category: Optional[str] = None

class LabelRes(BaseModel):
    id: str
    scheme_item_id: str
    value: str
    confidence: Optional[float] = None
    user_override: Optional[str] = None
    supporting_evidence_ids: list[str] = []

class EvidenceRes(BaseModel):
    id: str
    text: str
    page: int
    bbox_json: Optional[dict] = None
    relevant_code_ids: list[str] = []
    extracted_stats: list[dict] = []
    ai_reason: Optional[str] = None
    exact_quote: Optional[str] = None
    evidence_type: Optional[str] = None
    confidence: Optional[float] = None
    user_response: Optional[str] = None
    user_note: Optional[str] = None

class DocumentDetailRes(BaseModel):
    id: str
    filename: str
    page_count: int
    status: str
    labels: list[LabelRes] = []
    evidences: list[EvidenceRes] = []

class UpdateLabelsReq(BaseModel):
    labels: list[dict]

class UpdateEvidenceReq(BaseModel):
    evidence_id: str
    user_response: Optional[str] = None
    user_note: Optional[str] = None

class CodingSchemeTextReq(BaseModel):
    text: str

class ProcessStatusRes(BaseModel):
    task_id: str
    status: str
    total: int
    processed: int
    completed: int
    failed: int

class ProjectStatusRes(BaseModel):
    total: int
    completed: int
    processing: int
    pending: int


# ---------- Routes ----------

@app.get("/api/health")
def health():
    db_ok = True
    llm_ok = bool(os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY"))
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        db_ok = False
    usage = _shutil.disk_usage(DATA_DIR)
    return _ok(
        {
            "status": "ok" if db_ok else "degraded",
            "db": db_ok,
            "llm_configured": llm_ok,
            "disk_free_mb": round(usage.free / (1024 * 1024), 2),
        }
    )


@app.post("/api/projects")
def create_project(req: CreateProjectReq, db: Session = Depends(get_db)):
    project = Project(id=uuid.uuid4().hex[:12], mode=req.mode)
    db.add(project)
    db.commit()
    return _ok(ProjectRes(id=project.id, mode=project.mode).model_dump(), "Project created")


class UpdateProjectReq(BaseModel):
    mode: Literal["theme-verification", "evidence-verification"]


@app.put("/api/projects/{project_id}")
def update_project(project_id: str, req: UpdateProjectReq, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    project.mode = req.mode
    db.query(DocumentLabel).filter(
        DocumentLabel.document_id.in_(
            db.query(Document.id).filter(Document.project_id == project_id)
        )
    ).delete(synchronize_session=False)
    db.query(Evidence).filter(
        Evidence.document_id.in_(
            db.query(Document.id).filter(Document.project_id == project_id)
        )
    ).delete(synchronize_session=False)
    db.query(Document).filter(Document.project_id == project_id).update({"status": "pending"})
    db.commit()
    return _ok({"id": project.id, "mode": project.mode}, "Project mode updated")


@app.post("/api/projects/{project_id}/documents")
def upload_documents(
    project_id: str,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    project_dir = os.path.join(UPLOAD_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)

    created_docs = []
    for f in files:
        fname_lower = (f.filename or "").lower()
        if not fname_lower.endswith(".pdf") and not fname_lower.endswith(".zip"):
            raise HTTPException(400, f"Unsupported file type: {f.filename}. Only PDF and ZIP files are accepted.")
        raw_size = f.size or 0
        if raw_size > MAX_UPLOAD_MB * 1024 * 1024:
            raise HTTPException(400, f"File too large: {f.filename}. Max {MAX_UPLOAD_MB}MB.")

        safe_name = os.path.basename(f.filename or "file")
        file_path = os.path.join(project_dir, f"{uuid.uuid4().hex[:8]}_{safe_name}")
        with open(file_path, "wb") as buf:
            shutil.copyfileobj(f.file, buf)

        if fname_lower.endswith(".zip"):
            pdf_paths = file_service.extract_zip(file_path, project_dir)
            os.remove(file_path)
            for pp in pdf_paths:
                try:
                    page_count = pdf_service.get_page_count(pp)
                except Exception:
                    os.remove(pp)
                    continue
                doc = Document(
                    id=uuid.uuid4().hex[:12],
                    project_id=project_id,
                    filename=os.path.basename(pp).split("_", 1)[-1] if "_" in os.path.basename(pp) else os.path.basename(pp),
                    page_count=page_count,
                    status="pending",
                    file_path=pp,
                    error_message=None,
                )
                db.add(doc)
                created_docs.append(doc)
        else:
            try:
                page_count = pdf_service.get_page_count(file_path)
            except Exception:
                os.remove(file_path)
                raise HTTPException(400, f"Failed to read PDF: {f.filename}. The file may be corrupted.")
            doc = Document(
                id=uuid.uuid4().hex[:12],
                project_id=project_id,
                filename=f.filename,
                page_count=page_count,
                status="pending",
                file_path=file_path,
                error_message=None,
            )
            db.add(doc)
            created_docs.append(doc)

    db.commit()
    return _ok(
        [
            {"id": d.id, "filename": d.filename, "page_count": d.page_count, "status": d.status, "error_message": d.error_message}
            for d in created_docs
        ],
        "Documents uploaded",
    )


@app.post("/api/projects/{project_id}/coding-scheme")
def upload_coding_scheme(
    project_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).delete()

    project_dir = os.path.join(UPLOAD_DIR, project_id)
    os.makedirs(project_dir, exist_ok=True)
    file_path = os.path.join(project_dir, f"scheme_{file.filename}")
    with open(file_path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    try:
        items = file_service.parse_coding_scheme(file_path, file.filename)
    except ValueError as e:
        raise HTTPException(400, f"Invalid coding scheme: {e}")
    except Exception as e:
        raise HTTPException(400, f"Failed to parse coding scheme: {e}")

    if not items:
        raise HTTPException(400, "Coding scheme file is empty or contains no valid items")
    if len(items) > MAX_SCHEME_ITEMS:
        raise HTTPException(400, f"Too many coding scheme items. Max allowed: {MAX_SCHEME_ITEMS}")

    created = []
    for item in items:
        db_item = CodingSchemeItem(
            id=item["id"],
            project_id=project_id,
            code=item["code"],
            description=item["description"],
            category=item.get("category"),
        )
        db.add(db_item)
        created.append(db_item)

    db.commit()
    return _ok(
        [{"id": i.id, "code": i.code, "description": i.description, "category": i.category} for i in created],
        "Coding scheme uploaded",
    )


@app.post("/api/projects/{project_id}/coding-scheme/text")
def submit_coding_scheme_text(
    project_id: str,
    req: CodingSchemeTextReq,
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).delete()

    try:
        items = file_service.parse_coding_scheme_text(req.text)
    except ValueError as e:
        raise HTTPException(400, f"Invalid coding scheme: {e}")

    if not items:
        raise HTTPException(400, "No valid coding scheme items found in the provided text")
    if len(items) > MAX_SCHEME_ITEMS:
        raise HTTPException(400, f"Too many coding scheme items. Max allowed: {MAX_SCHEME_ITEMS}")

    created = []
    for item in items:
        db_item = CodingSchemeItem(
            id=item["id"],
            project_id=project_id,
            code=item["code"],
            description=item["description"],
            category=item.get("category"),
        )
        db.add(db_item)
        created.append(db_item)

    db.commit()
    return _ok(
        [{"id": i.id, "code": i.code, "description": i.description, "category": i.category} for i in created],
        "Coding scheme submitted",
    )


@app.post("/api/projects/{project_id}/process")
def process_project(project_id: str, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Queue AI analysis on all pending documents in the project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    scheme_items = db.query(CodingSchemeItem).filter(
        CodingSchemeItem.project_id == project_id
    ).all()
    if not scheme_items:
        raise HTTPException(400, "No coding scheme uploaded")

    documents = db.query(Document).filter(
        Document.project_id == project_id,
        Document.status.in_(["pending", "error"]),
    ).all()
    task_id = uuid.uuid4().hex[:12]
    _PROCESS_TASKS[task_id] = {
        "task_id": task_id,
        "status": "queued",
        "project_id": project_id,
        "total": len(documents),
        "processed": 0,
        "completed": 0,
        "failed": 0,
    }
    background_tasks.add_task(_process_documents_task, task_id, project_id)
    return _ok({"task_id": task_id, "total": len(documents)}, "Processing started")


def _process_one_document(project_mode: str, doc_id: str, scheme_dicts: list[dict]):
    local_db = SessionLocal()
    try:
        doc = local_db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            return False, "Document not found"
        doc.status = "processing"
        doc.error_message = None
        local_db.commit()

        if not doc.file_path or not os.path.exists(doc.file_path):
            doc.status = "error"
            doc.error_message = "File missing on disk"
            local_db.commit()
            return False, doc.error_message

        if doc.text_blocks_cache:
            text_blocks = [pdf_service.TextBlock.from_dict(x) for x in (doc.text_blocks_cache or [])]
        else:
            text_blocks = pdf_service.extract_text_blocks(doc.file_path)
            doc.text_blocks_cache = [b.to_dict() for b in text_blocks]
            local_db.commit()

        if project_mode == "theme-verification":
            labels = ai_service.generate_labels(text_blocks, scheme_dicts, evidences=None)
            local_db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).delete()
            for label in labels:
                local_db.add(DocumentLabel(
                    id=uuid.uuid4().hex[:12],
                    document_id=doc.id,
                    scheme_item_id=label.scheme_item_id,
                    value=label.value,
                    confidence=label.confidence,
                    supporting_evidence_ids=label.supporting_evidence_ids or [],
                ))
        else:
            evidences = ai_service.extract_evidences(text_blocks, scheme_dicts)
            local_db.query(Evidence).filter(Evidence.document_id == doc.id).delete()
            for ev in evidences:
                local_db.add(Evidence(
                    id=ev.id or uuid.uuid4().hex[:12],
                    document_id=doc.id,
                    text=ev.text,
                    page=ev.page,
                    bbox_json=ev.bbox,
                    relevant_code_ids=ev.relevant_code_ids,
                    extracted_stats=ev.extracted_stats or [],
                    ai_reason=ev.ai_reason,
                    exact_quote=ev.exact_quote,
                    evidence_type=ev.evidence_type,
                    confidence=ev.confidence,
                ))
            labels = ai_service.generate_labels(text_blocks, scheme_dicts, evidences=evidences)
            local_db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).delete()
            for label in labels:
                local_db.add(DocumentLabel(
                    id=uuid.uuid4().hex[:12],
                    document_id=doc.id,
                    scheme_item_id=label.scheme_item_id,
                    value=label.value,
                    confidence=label.confidence,
                    supporting_evidence_ids=label.supporting_evidence_ids or [],
                ))

        doc.status = "completed"
        doc.error_message = None
        local_db.commit()
        return True, ""
    except Exception as e:
        local_db.rollback()
        doc = local_db.query(Document).filter(Document.id == doc_id).first()
        if doc:
            doc.status = "error"
            doc.error_message = str(e)[:1500]
            local_db.commit()
        logger.exception("Error processing document %s", doc_id)
        return False, str(e)
    finally:
        local_db.close()


def _process_documents_task(task_id: str, project_id: str):
    task = _PROCESS_TASKS.get(task_id)
    if not task:
        return
    task["status"] = "running"
    db = SessionLocal()
    project_mode = "evidence-verification"
    scheme_dicts: list[dict] = []
    doc_ids: list[str] = []
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            task["status"] = "failed"
            return
        project_mode = project.mode
        scheme_items = db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all()
        scheme_dicts = [{"id": s.id, "code": s.code, "description": s.description, "category": s.category} for s in scheme_items]
        documents = db.query(Document).filter(
            Document.project_id == project_id,
            Document.status.in_(["pending", "error"]),
        ).all()
        task["total"] = len(documents)
        doc_ids = [d.id for d in documents]
    finally:
        db.close()

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(_process_one_document, project_mode, doc_id, scheme_dicts) for doc_id in doc_ids]
        for f in as_completed(futures):
            ok, _ = f.result()
            task["processed"] += 1
            if ok:
                task["completed"] += 1
            else:
                task["failed"] += 1
    task["status"] = "completed"


@app.get("/api/projects/{project_id}/process/status")
def get_process_status(project_id: str, task_id: str = Query(...)):
    task = _PROCESS_TASKS.get(task_id)
    if not task or task.get("project_id") != project_id:
        raise HTTPException(404, "Process task not found")
    return _ok(ProcessStatusRes(
        task_id=task["task_id"],
        status=task["status"],
        total=task["total"],
        processed=task["processed"],
        completed=task["completed"],
        failed=task["failed"],
    ).model_dump())


@app.get("/api/projects/{project_id}/status")
def get_project_status(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    return _ok(ProjectStatusRes(
        total=len(docs),
        completed=sum(1 for d in docs if d.status == "completed"),
        processing=sum(1 for d in docs if d.status == "processing"),
        pending=sum(1 for d in docs if d.status == "pending"),
    ).model_dump())


@app.get("/api/projects/{project_id}/documents")
def list_documents(
    project_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    sort: str = Query("filename", pattern="^(filename|status|page_count)$"),
    order: str = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
):
    q = db.query(Document).filter(Document.project_id == project_id)
    total_count = q.count()
    sort_col = {
        "filename": Document.filename,
        "status": Document.status,
        "page_count": Document.page_count,
    }[sort]
    if order == "desc":
        q = q.order_by(sort_col.desc())
    else:
        q = q.order_by(sort_col.asc())
    docs = q.offset((page - 1) * per_page).limit(per_page).all()
    return _ok(
        {
            "items": [
                {
                    "id": d.id,
                    "filename": d.filename,
                    "page_count": d.page_count,
                    "status": d.status,
                    "error_message": d.error_message,
                }
                for d in docs
            ],
            "page": page,
            "per_page": per_page,
            "total_count": total_count,
        }
    )


@app.get("/api/projects/{project_id}/documents/{doc_id}")
def get_document_detail(project_id: str, doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    labels = db.query(DocumentLabel).filter(DocumentLabel.document_id == doc_id).all()
    evidences = db.query(Evidence).filter(Evidence.document_id == doc_id).order_by(Evidence.page.asc()).all()
    return _ok({
        "id": doc.id,
        "filename": doc.filename,
        "page_count": doc.page_count,
        "status": doc.status,
        "error_message": doc.error_message,
        "labels": [
            {
                "id": l.id,
                "scheme_item_id": l.scheme_item_id,
                "value": l.user_override or l.value,
                "confidence": l.confidence,
                "user_override": l.user_override,
                "supporting_evidence_ids": l.supporting_evidence_ids or [],
            }
            for l in labels
        ],
        "evidences": [
            {
                "id": e.id,
                "text": e.text,
                "page": e.page,
                "bbox_json": e.bbox_json,
                "relevant_code_ids": e.relevant_code_ids or [],
                "extracted_stats": e.extracted_stats or [],
                "ai_reason": e.ai_reason,
                "exact_quote": e.exact_quote,
                "evidence_type": e.evidence_type,
                "confidence": e.confidence,
                "user_response": e.user_response,
                "user_note": e.user_note,
            }
            for e in evidences
        ],
    })


@app.get("/api/projects/{project_id}/documents/{doc_id}/evidences")
def list_document_evidences(
    project_id: str,
    doc_id: str,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    q = db.query(Evidence).filter(Evidence.document_id == doc_id).order_by(Evidence.page.asc())
    total_count = q.count()
    evidences = q.offset((page - 1) * per_page).limit(per_page).all()
    return _ok(
        {
            "items": [
                {
                    "id": e.id,
                    "text": e.text,
                    "page": e.page,
                    "bbox_json": e.bbox_json,
                    "relevant_code_ids": e.relevant_code_ids or [],
                    "extracted_stats": e.extracted_stats or [],
                    "ai_reason": e.ai_reason,
                    "exact_quote": e.exact_quote,
                    "evidence_type": e.evidence_type,
                    "confidence": e.confidence,
                    "user_response": e.user_response,
                    "user_note": e.user_note,
                }
                for e in evidences
            ],
            "page": page,
            "per_page": per_page,
            "total_count": total_count,
        }
    )


@app.get("/api/projects/{project_id}/documents/{doc_id}/pdf")
def get_document_pdf(project_id: str, doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc or not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(404, "PDF not found")
    return FileResponse(doc.file_path, media_type="application/pdf", filename=doc.filename)


@app.put("/api/projects/{project_id}/documents/{doc_id}/labels")
def update_labels(project_id: str, doc_id: str, req: UpdateLabelsReq, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    for item in req.labels:
        label = db.query(DocumentLabel).filter(
            DocumentLabel.document_id == doc_id,
            DocumentLabel.scheme_item_id == item.get("scheme_item_id"),
        ).first()
        if label:
            label.user_override = item.get("value", label.value)
            if item.get("supporting_evidence_ids") is not None:
                label.supporting_evidence_ids = item.get("supporting_evidence_ids")
    db.commit()
    return _ok(None, "Labels updated")


@app.put("/api/projects/{project_id}/documents/{doc_id}/evidences")
def update_evidence(project_id: str, doc_id: str, req: UpdateEvidenceReq, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    ev = db.query(Evidence).filter(Evidence.id == req.evidence_id, Evidence.document_id == doc_id).first()
    if not ev:
        raise HTTPException(404, "Evidence not found")

    if req.user_response is not None:
        ev.user_response = req.user_response
    if req.user_note is not None:
        ev.user_note = req.user_note
    db.commit()
    return _ok(None, "Evidence updated")


@app.get("/api/projects/{project_id}/coding-scheme")
def get_coding_scheme(project_id: str, db: Session = Depends(get_db)):
    items = db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all()
    return _ok([
        {"id": i.id, "code": i.code, "description": i.description, "category": i.category}
        for i in items
    ])


@app.get("/api/projects/{project_id}/export")
def export_project(
    project_id: str,
    format: str = Query("excel", pattern="^(excel|csv|json|bibtex|ris)$"),
    db: Session = Depends(get_db),
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    if format == "csv":
        csv_data = export_service.export_project_csv(db, project_id)
        return Response(
            content=csv_data,
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=slr_export_{project_id}.csv"},
        )
    if format == "json":
        json_data = export_service.export_project_json(db, project_id)
        return Response(
            content=json_data,
            media_type="application/json",
            headers={"Content-Disposition": f"attachment; filename=slr_export_{project_id}.json"},
        )
    if format in ("bibtex", "ris"):
        txt_data = export_service.export_project_references(db, project_id, format=format)
        media = "application/x-bibtex" if format == "bibtex" else "application/x-research-info-systems"
        ext = "bib" if format == "bibtex" else "ris"
        return Response(
            content=txt_data,
            media_type=media,
            headers={"Content-Disposition": f"attachment; filename=slr_export_{project_id}.{ext}"},
        )
    else:
        excel_data = export_service.export_project_excel(db, project_id)
        return Response(
            content=excel_data,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=slr_export_{project_id}.xlsx"},
        )


@app.delete("/api/projects/{project_id}/documents/{doc_id}")
def delete_document(project_id: str, doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)
    db.delete(doc)
    db.commit()
    return _ok(None, "Document deleted")


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    for d in docs:
        if d.file_path and os.path.exists(d.file_path):
            os.remove(d.file_path)
    project_dir = os.path.join(UPLOAD_DIR, project_id)
    if os.path.isdir(project_dir):
        shutil.rmtree(project_dir, ignore_errors=True)
    db.delete(project)
    db.commit()
    return _ok(None, "Project deleted")

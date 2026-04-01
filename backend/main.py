import os
import uuid
import shutil
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import engine, get_db, Base
from models import Project, Document, CodingSchemeItem, DocumentLabel, Evidence
from services import pdf_service, ai_service, file_service, export_service

load_dotenv()

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


# ---------- Schemas ----------

class CreateProjectReq(BaseModel):
    mode: str

class ProjectRes(BaseModel):
    id: str
    mode: str

class DocumentRes(BaseModel):
    id: str
    filename: str
    page_count: int
    status: str

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

class EvidenceRes(BaseModel):
    id: str
    text: str
    page: int
    bbox_json: Optional[dict] = None
    relevant_code_ids: list[str] = []
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

class ProjectStatusRes(BaseModel):
    total: int
    completed: int
    processing: int
    pending: int


# ---------- Routes ----------

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/projects", response_model=ProjectRes)
def create_project(req: CreateProjectReq, db: Session = Depends(get_db)):
    project = Project(id=uuid.uuid4().hex[:12], mode=req.mode)
    db.add(project)
    db.commit()
    return ProjectRes(id=project.id, mode=project.mode)


class UpdateProjectReq(BaseModel):
    mode: str


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
    return {"id": project.id, "mode": project.mode}


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
            )
            db.add(doc)
            created_docs.append(doc)

    db.commit()
    return [
        {"id": d.id, "filename": d.filename, "page_count": d.page_count, "status": d.status}
        for d in created_docs
    ]


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
    return [
        {"id": i.id, "code": i.code, "description": i.description, "category": i.category}
        for i in created
    ]


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
    return [
        {"id": i.id, "code": i.code, "description": i.description, "category": i.category}
        for i in created
    ]


@app.post("/api/projects/{project_id}/process")
def process_project(project_id: str, db: Session = Depends(get_db)):
    """Run AI analysis on all pending documents in the project."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")

    scheme_items = db.query(CodingSchemeItem).filter(
        CodingSchemeItem.project_id == project_id
    ).all()
    if not scheme_items:
        raise HTTPException(400, "No coding scheme uploaded")

    scheme_dicts = [
        {"id": s.id, "code": s.code, "description": s.description, "category": s.category}
        for s in scheme_items
    ]

    documents = db.query(Document).filter(
        Document.project_id == project_id,
        Document.status.in_(["pending", "error"]),
    ).all()

    for doc in documents:
        doc.status = "processing"
        db.commit()

        try:
            if not doc.file_path or not os.path.exists(doc.file_path):
                doc.status = "error"
                db.commit()
                continue

            text_blocks = pdf_service.extract_text_blocks(doc.file_path)

            if project.mode == "theme-verification":
                labels = ai_service.generate_labels(text_blocks, scheme_dicts)
                db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).delete()
                for label in labels:
                    db.add(DocumentLabel(
                        id=uuid.uuid4().hex[:12],
                        document_id=doc.id,
                        scheme_item_id=label.scheme_item_id,
                        value=label.value,
                        confidence=label.confidence,
                    ))
            else:
                evidences = ai_service.extract_evidences(text_blocks, scheme_dicts)
                db.query(Evidence).filter(Evidence.document_id == doc.id).delete()
                for ev in evidences:
                    db.add(Evidence(
                        id=uuid.uuid4().hex[:12],
                        document_id=doc.id,
                        text=ev.text,
                        page=ev.page,
                        bbox_json=ev.bbox,
                        relevant_code_ids=ev.relevant_code_ids,
                    ))
                labels = ai_service.generate_labels(text_blocks, scheme_dicts)
                db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).delete()
                for label in labels:
                    db.add(DocumentLabel(
                        id=uuid.uuid4().hex[:12],
                        document_id=doc.id,
                        scheme_item_id=label.scheme_item_id,
                        value=label.value,
                        confidence=label.confidence,
                    ))

            doc.status = "completed"
            db.commit()
        except Exception as e:
            doc.status = "error"
            db.commit()
            print(f"Error processing {doc.filename}: {e}")

    return {"message": "Processing complete"}


@app.get("/api/projects/{project_id}/status", response_model=ProjectStatusRes)
def get_project_status(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found")
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    return ProjectStatusRes(
        total=len(docs),
        completed=sum(1 for d in docs if d.status == "completed"),
        processing=sum(1 for d in docs if d.status == "processing"),
        pending=sum(1 for d in docs if d.status == "pending"),
    )


@app.get("/api/projects/{project_id}/documents")
def list_documents(project_id: str, db: Session = Depends(get_db)):
    docs = db.query(Document).filter(Document.project_id == project_id).all()
    return [
        {"id": d.id, "filename": d.filename, "page_count": d.page_count, "status": d.status}
        for d in docs
    ]


@app.get("/api/projects/{project_id}/documents/{doc_id}")
def get_document_detail(project_id: str, doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id, Document.project_id == project_id).first()
    if not doc:
        raise HTTPException(404, "Document not found")

    labels = db.query(DocumentLabel).filter(DocumentLabel.document_id == doc_id).all()
    evidences = db.query(Evidence).filter(Evidence.document_id == doc_id).all()

    return {
        "id": doc.id,
        "filename": doc.filename,
        "page_count": doc.page_count,
        "status": doc.status,
        "labels": [
            {
                "id": l.id,
                "scheme_item_id": l.scheme_item_id,
                "value": l.user_override or l.value,
                "confidence": l.confidence,
                "user_override": l.user_override,
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
                "user_response": e.user_response,
                "user_note": e.user_note,
            }
            for e in evidences
        ],
    }


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
    db.commit()
    return {"message": "Labels updated"}


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
    return {"message": "Evidence updated"}


@app.get("/api/projects/{project_id}/coding-scheme")
def get_coding_scheme(project_id: str, db: Session = Depends(get_db)):
    items = db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all()
    return [
        {"id": i.id, "code": i.code, "description": i.description, "category": i.category}
        for i in items
    ]


@app.get("/api/projects/{project_id}/export")
def export_project(
    project_id: str,
    format: str = Query("excel", pattern="^(excel|csv)$"),
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
    return {"message": "Document deleted"}

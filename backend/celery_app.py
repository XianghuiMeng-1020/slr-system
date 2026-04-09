"""Optional Celery app for long-running PDF jobs. Start worker: celery -A celery_app worker -l info"""
from __future__ import annotations

import os

from celery import Celery

_broker = os.getenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
app = Celery("slr_system", broker=_broker, backend=os.getenv("CELERY_RESULT_BACKEND", _broker))


@app.task(name="slr.ping")
def ping() -> str:
    return "pong"


@app.task(name="slr.process_document")
def process_document_task(document_id: str, project_id: str) -> dict:
    from database import SessionLocal
    from models import Project, CodingSchemeItem
    from services.document_processor import process_one_document

    db = SessionLocal()
    try:
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            return {"ok": False, "error": "no project"}
        scheme_items = db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all()
        scheme_dicts = [{"id": s.id, "code": s.code, "description": s.description, "category": s.category} for s in scheme_items]
        ok, err = process_one_document(project.mode, document_id, scheme_dicts)
        return {"ok": ok, "error": err}
    finally:
        db.close()

"""Single-document AI processing (shared by FastAPI thread pool and optional Celery worker)."""
from __future__ import annotations

import logging
import os
import uuid

from sqlalchemy.orm import Session

from database import SessionLocal
from models import Document, DocumentLabel, Evidence, Project
from services import ai_service, pdf_service
from services.phase2_core import active_learning_snippets

logger = logging.getLogger(__name__)


def process_one_document(project_mode: str, doc_id: str, scheme_dicts: list[dict]) -> tuple[bool, str]:
    local_db: Session = SessionLocal()
    try:
        doc = local_db.query(Document).filter(Document.id == doc_id).first()
        if not doc:
            return False, "Document not found"
        doc.status = "processing"
        doc.error_message = None
        local_db.commit()

        if doc.text_blocks_cache:
            text_blocks = [pdf_service.TextBlock.from_dict(x) for x in (doc.text_blocks_cache or [])]
        elif doc.file_path and os.path.exists(doc.file_path):
            text_blocks = pdf_service.extract_text_blocks(doc.file_path)
            doc.text_blocks_cache = [b.to_dict() for b in text_blocks]
            local_db.commit()
        else:
            doc.status = "error"
            doc.error_message = "No PDF file and no cached text"
            local_db.commit()
            return False, doc.error_message

        project_llm_context = ""
        proj = local_db.query(Project).filter(Project.id == doc.project_id).first()
        if proj and isinstance(proj.settings_json, dict):
            s = proj.settings_json
            parts: list[str] = []
            cp = s.get("custom_system_prompt")
            if cp and str(cp).strip():
                parts.append(str(cp).strip())
            al = active_learning_snippets(s)
            if al:
                parts.append(al)
            project_llm_context = "\n\n".join(parts) if parts else ""

        if project_mode == "theme-verification":
            labels = ai_service.generate_labels(
                text_blocks, scheme_dicts, evidences=None, extra_context=project_llm_context or None
            )
            local_db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).delete()
            for label in labels:
                local_db.add(
                    DocumentLabel(
                        id=uuid.uuid4().hex[:12],
                        document_id=doc.id,
                        scheme_item_id=label.scheme_item_id,
                        value=label.value,
                        confidence=label.confidence,
                        supporting_evidence_ids=label.supporting_evidence_ids or [],
                    )
                )
        else:
            evidences = ai_service.extract_evidences(
                text_blocks, scheme_dicts, extra_context=project_llm_context or None
            )
            local_db.query(Evidence).filter(Evidence.document_id == doc.id).delete()
            for ev in evidences:
                local_db.add(
                    Evidence(
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
                    )
                )
            labels = ai_service.generate_labels(
                text_blocks, scheme_dicts, evidences=evidences, extra_context=project_llm_context or None
            )
            local_db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).delete()
            for label in labels:
                local_db.add(
                    DocumentLabel(
                        id=uuid.uuid4().hex[:12],
                        document_id=doc.id,
                        scheme_item_id=label.scheme_item_id,
                        value=label.value,
                        confidence=label.confidence,
                        supporting_evidence_ids=label.supporting_evidence_ids or [],
                    )
                )

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

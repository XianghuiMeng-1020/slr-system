from __future__ import annotations
import csv
import io
import json
import openpyxl
from sqlalchemy.orm import Session

from models import Project, Document, DocumentLabel, Evidence, CodingSchemeItem


def export_project_excel(db: Session, project_id: str) -> bytes:
    """Export project results to an Excel file."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError("Project not found")

    wb = openpyxl.Workbook()

    scheme_items = db.query(CodingSchemeItem).filter(
        CodingSchemeItem.project_id == project_id
    ).all()
    scheme_map = {s.id: s for s in scheme_items}

    # --- Labels sheet ---
    ws_labels = wb.active
    ws_labels.title = "Coding Labels"
    headers = ["Document", "Code", "Description", "Category", "AI Label", "Confidence", "User Override"]
    ws_labels.append(headers)

    documents = db.query(Document).filter(Document.project_id == project_id).all()
    for doc in documents:
        labels = db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).all()
        for label in labels:
            scheme = scheme_map.get(label.scheme_item_id)
            ws_labels.append([
                doc.filename,
                scheme.code if scheme else "",
                scheme.description if scheme else "",
                scheme.category if scheme else "",
                label.value,
                label.confidence,
                label.user_override or "",
            ])

    # --- Evidence sheet ---
    ws_evidence = wb.create_sheet("Evidence Responses")
    ev_headers = [
        "Document",
        "Evidence Text",
        "Page",
        "Related Codes",
        "Confidence",
        "Evidence Type",
        "AI Reason",
        "Extracted Stats",
        "User Response",
        "User Note",
    ]
    ws_evidence.append(ev_headers)

    for doc in documents:
        evidences = db.query(Evidence).filter(Evidence.document_id == doc.id).all()
        for ev in evidences:
            code_ids = ev.relevant_code_ids or []
            code_names = [scheme_map[cid].code for cid in code_ids if cid in scheme_map]
            ws_evidence.append([
                doc.filename,
                ev.text[:500],
                ev.page,
                ", ".join(code_names),
                ev.confidence,
                ev.evidence_type or "",
                ev.ai_reason or "",
                json.dumps(ev.extracted_stats or [], ensure_ascii=False),
                ev.user_response or "",
                ev.user_note or "",
            ])

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def export_project_csv(db: Session, project_id: str) -> str:
    """Export project results to CSV string."""
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError("Project not found")

    output = io.StringIO()
    writer = csv.writer(output)

    scheme_items = db.query(CodingSchemeItem).filter(
        CodingSchemeItem.project_id == project_id
    ).all()
    scheme_map = {s.id: s for s in scheme_items}

    writer.writerow(["Document", "Code", "Description", "Category", "Value", "Confidence",
                      "User Override", "Evidence Count", "Yes Count", "No Count"])

    documents = db.query(Document).filter(Document.project_id == project_id).all()
    for doc in documents:
        labels = db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).all()
        evidences = db.query(Evidence).filter(Evidence.document_id == doc.id).all()
        yes_count = sum(1 for e in evidences if e.user_response == "yes")
        no_count = sum(1 for e in evidences if e.user_response == "no")

        for label in labels:
            scheme = scheme_map.get(label.scheme_item_id)
            writer.writerow([
                doc.filename,
                scheme.code if scheme else "",
                scheme.description if scheme else "",
                scheme.category if scheme else "",
                label.value,
                label.confidence,
                label.user_override or "",
                len(evidences),
                yes_count,
                no_count,
            ])

    return output.getvalue()


def export_project_json(db: Session, project_id: str) -> str:
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise ValueError("Project not found")
    scheme_items = db.query(CodingSchemeItem).filter(CodingSchemeItem.project_id == project_id).all()
    documents = db.query(Document).filter(Document.project_id == project_id).all()
    payload = {
        "project": {"id": project.id, "mode": project.mode},
        "coding_scheme": [
            {"id": s.id, "code": s.code, "description": s.description, "category": s.category}
            for s in scheme_items
        ],
        "documents": [],
    }
    for doc in documents:
        labels = db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).all()
        evidences = db.query(Evidence).filter(Evidence.document_id == doc.id).all()
        payload["documents"].append({
            "id": doc.id,
            "filename": doc.filename,
            "page_count": doc.page_count,
            "status": doc.status,
            "labels": [
                {
                    "scheme_item_id": l.scheme_item_id,
                    "value": l.value,
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
    return json.dumps(payload, ensure_ascii=False, indent=2)


def export_project_references(db: Session, project_id: str, format: str = "bibtex") -> str:
    documents = db.query(Document).filter(Document.project_id == project_id).all()
    lines: list[str] = []
    for idx, d in enumerate(documents, start=1):
        key = re_sub_nonword(d.filename.lower().rsplit(".", 1)[0])[:30] or f"doc{idx}"
        if format == "bibtex":
            lines.append(
                f"@misc{{{key},\n"
                f"  title = {{{d.filename}}},\n"
                f"  note = {{Imported in SLR System project {project_id}}}\n"
                f"}}\n"
            )
        else:
            lines.append(
                "TY  - JOUR\n"
                f"TI  - {d.filename}\n"
                f"N1  - Imported in SLR System project {project_id}\n"
                "ER  - \n"
            )
    return "\n".join(lines)


def re_sub_nonword(text: str) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "", text)

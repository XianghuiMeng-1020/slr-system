from __future__ import annotations
import csv
import io
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

    # --- Labels sheet ---
    ws_labels = wb.active
    ws_labels.title = "Coding Labels"
    headers = ["Document", "Code", "Description", "Category", "AI Label", "Confidence", "User Override"]
    ws_labels.append(headers)

    documents = db.query(Document).filter(Document.project_id == project_id).all()
    for doc in documents:
        labels = db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).all()
        for label in labels:
            scheme = db.query(CodingSchemeItem).filter(CodingSchemeItem.id == label.scheme_item_id).first()
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
    ev_headers = ["Document", "Evidence Text", "Page", "Related Codes", "User Response", "User Note"]
    ws_evidence.append(ev_headers)

    for doc in documents:
        evidences = db.query(Evidence).filter(Evidence.document_id == doc.id).all()
        for ev in evidences:
            code_ids = ev.relevant_code_ids or []
            code_names = []
            for cid in code_ids:
                s = db.query(CodingSchemeItem).filter(CodingSchemeItem.id == cid).first()
                if s:
                    code_names.append(s.code)
            ws_evidence.append([
                doc.filename,
                ev.text[:500],
                ev.page,
                ", ".join(code_names),
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

    writer.writerow(["Document", "Code", "Description", "Category", "Value", "Confidence",
                      "User Override", "Evidence Count", "Yes Count", "No Count"])

    documents = db.query(Document).filter(Document.project_id == project_id).all()
    for doc in documents:
        labels = db.query(DocumentLabel).filter(DocumentLabel.document_id == doc.id).all()
        evidences = db.query(Evidence).filter(Evidence.document_id == doc.id).all()
        yes_count = sum(1 for e in evidences if e.user_response == "yes")
        no_count = sum(1 for e in evidences if e.user_response == "no")

        for label in labels:
            scheme = db.query(CodingSchemeItem).filter(CodingSchemeItem.id == label.scheme_item_id).first()
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

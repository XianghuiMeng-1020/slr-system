from __future__ import annotations

import io
import pathlib
import sys
import time

import fitz
from fastapi.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

import main  # type: ignore  # noqa: E402
from services.ai_service import EvidenceResult, LabelResult  # type: ignore  # noqa: E402


client = TestClient(main.app)


def _unwrap(resp):
    payload = resp.json()
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _make_pdf_bytes(text: str = "Sample study result p < 0.05 with N=100.") -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    out = io.BytesIO()
    doc.save(out)
    doc.close()
    return out.getvalue()


def _mock_extract_evidences(text_blocks, scheme, extra_context=None, **_kwargs):
    if not text_blocks:
        return []
    first = text_blocks[0]
    return [
        EvidenceResult(
            id="ev_mock_1",
            text=first.text,
            page=first.page,
            bbox=first.bbox,
            relevant_code_ids=[scheme[0]["id"]] if scheme else [],
            ai_reason="mock reason",
            confidence=0.88,
            extracted_stats=[{"type": "p_value", "value": "p < 0.05"}],
            exact_quote=first.text[:120],
            evidence_type="statistical",
        )
    ]


def _mock_generate_labels(text_blocks, scheme, evidences=None, extra_context=None, **_kwargs):
    out = []
    for s in scheme:
        out.append(
            LabelResult(
                scheme_item_id=s["id"],
                value="Present",
                confidence=0.9,
                supporting_evidence_ids=[e.id for e in (evidences or [])],
            )
        )
    return out


def _create_project(mode: str = "evidence-verification") -> str:
    r = client.post("/api/projects", json={"mode": mode})
    assert r.status_code == 200
    return _unwrap(r)["id"]


def _upload_scheme(project_id: str):
    content = "code,description\nC1,methodology effect\nC2,result significance\n"
    resp = client.post(
        f"/api/projects/{project_id}/coding-scheme",
        files={"file": ("scheme.csv", content, "text/csv")},
    )
    assert resp.status_code == 200


def _upload_pdf(project_id: str):
    pdf = _make_pdf_bytes()
    resp = client.post(
        f"/api/projects/{project_id}/documents",
        files=[("files", ("paper.pdf", pdf, "application/pdf"))],
    )
    assert resp.status_code == 200


def test_documents_pagination_and_sorting():
    project_id = _create_project("theme-verification")
    try:
        _upload_scheme(project_id)
        for i in range(3):
            text = f"Paper {i} method with p < 0.0{i+1}"
            pdf = _make_pdf_bytes(text)
            resp = client.post(
                f"/api/projects/{project_id}/documents",
                files=[("files", (f"paper_{i}.pdf", pdf, "application/pdf"))],
            )
            assert resp.status_code == 200

        resp = client.get(
            f"/api/projects/{project_id}/documents",
            params={"page": 1, "per_page": 2, "sort": "filename", "order": "asc"},
        )
        assert resp.status_code == 200
        data = _unwrap(resp)
        assert data["total_count"] >= 3
        assert len(data["items"]) == 2
    finally:
        client.delete(f"/api/projects/{project_id}")


def test_process_status_and_export_json():
    project_id = _create_project("evidence-verification")
    try:
        main.ai_service.extract_evidences = _mock_extract_evidences
        main.ai_service.generate_labels = _mock_generate_labels
        _upload_scheme(project_id)
        _upload_pdf(project_id)

        started = client.post(f"/api/projects/{project_id}/process")
        assert started.status_code == 200
        task_id = _unwrap(started)["task_id"]

        final_status = None
        for _ in range(30):
            s = client.get(f"/api/projects/{project_id}/process/status", params={"task_id": task_id})
            assert s.status_code == 200
            status_data = _unwrap(s)
            final_status = status_data["status"]
            if final_status in ("completed", "failed"):
                break
            time.sleep(0.2)
        assert final_status == "completed"

        docs = client.get(f"/api/projects/{project_id}/documents")
        first_doc = _unwrap(docs)["items"][0]
        detail = client.get(f"/api/projects/{project_id}/documents/{first_doc['id']}")
        assert detail.status_code == 200
        detail_data = _unwrap(detail)
        assert "evidences" in detail_data

        export_resp = client.get(f"/api/projects/{project_id}/export", params={"format": "json"})
        assert export_resp.status_code == 200
        assert "application/json" in export_resp.headers.get("content-type", "")
    finally:
        client.delete(f"/api/projects/{project_id}")


def test_health_endpoint_extended():
    resp = client.get("/api/health")
    assert resp.status_code == 200
    data = _unwrap(resp)
    assert "db" in data
    assert "disk_free_mb" in data
    assert isinstance(data["disk_free_mb"], (float, int))


def test_export_bibtex_and_ris():
    project_id = _create_project("theme-verification")
    try:
        _upload_scheme(project_id)
        _upload_pdf(project_id)

        bib = client.get(f"/api/projects/{project_id}/export", params={"format": "bibtex"})
        assert bib.status_code == 200
        assert "@misc{" in bib.text
        assert "application/x-bibtex" in bib.headers.get("content-type", "")

        ris = client.get(f"/api/projects/{project_id}/export", params={"format": "ris"})
        assert ris.status_code == 200
        assert "TY  - JOUR" in ris.text
        assert "application/x-research-info-systems" in ris.headers.get("content-type", "")
    finally:
        client.delete(f"/api/projects/{project_id}")


def test_pagination_boundary_and_invalid_sort():
    project_id = _create_project("theme-verification")
    try:
        _upload_scheme(project_id)
        _upload_pdf(project_id)

        boundary = client.get(
            f"/api/projects/{project_id}/documents",
            params={"page": 999, "per_page": 20, "sort": "filename", "order": "asc"},
        )
        assert boundary.status_code == 200
        data = _unwrap(boundary)
        assert data["items"] == []

        invalid = client.get(
            f"/api/projects/{project_id}/documents",
            params={"page": 1, "per_page": 20, "sort": "bad_sort", "order": "asc"},
        )
        assert invalid.status_code == 422
    finally:
        client.delete(f"/api/projects/{project_id}")


def test_delete_project_then_access_returns_404():
    project_id = _create_project("theme-verification")
    _upload_scheme(project_id)
    _upload_pdf(project_id)

    deleted = client.delete(f"/api/projects/{project_id}")
    assert deleted.status_code == 200

    status = client.get(f"/api/projects/{project_id}/status")
    assert status.status_code == 404

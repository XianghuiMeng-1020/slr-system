import datetime
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey, JSON, Index
from sqlalchemy.orm import relationship
from database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    mode = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    settings_json = Column(JSON, nullable=True)

    documents = relationship("Document", back_populates="project", cascade="all, delete-orphan")
    coding_scheme_items = relationship("CodingSchemeItem", back_populates="project", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    filename = Column(String, nullable=False)
    page_count = Column(Integer, default=0)
    status = Column(String, default="pending")
    file_path = Column(String, nullable=True)
    error_message = Column(Text, nullable=True)
    text_blocks_cache = Column(JSON, nullable=True)
    doi = Column(String, nullable=True, index=True)
    title = Column(Text, nullable=True)
    metadata_json = Column(JSON, nullable=True)

    project = relationship("Project", back_populates="documents")
    labels = relationship("DocumentLabel", back_populates="document", cascade="all, delete-orphan")
    evidences = relationship("Evidence", back_populates="document", cascade="all, delete-orphan")


class CodingSchemeItem(Base):
    __tablename__ = "coding_scheme_items"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    code = Column(String, nullable=False)
    description = Column(String, nullable=False)
    category = Column(String, nullable=True)

    project = relationship("Project", back_populates="coding_scheme_items")


class DocumentLabel(Base):
    __tablename__ = "document_labels"
    __table_args__ = (
        Index("ix_document_labels_document_scheme", "document_id", "scheme_item_id"),
    )

    id = Column(String, primary_key=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    scheme_item_id = Column(String, ForeignKey("coding_scheme_items.id"), nullable=False, index=True)
    value = Column(String, default="Unclear")
    confidence = Column(Float, nullable=True)
    user_override = Column(String, nullable=True)
    supporting_evidence_ids = Column(JSON, default=list)
    reviewer_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)

    document = relationship("Document", back_populates="labels")


class Evidence(Base):
    __tablename__ = "evidences"

    id = Column(String, primary_key=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    page = Column(Integer, nullable=False)
    bbox_json = Column(JSON, nullable=True)
    relevant_code_ids = Column(JSON, default=list)
    extracted_stats = Column(JSON, default=list)
    ai_reason = Column(Text, nullable=True)
    exact_quote = Column(Text, nullable=True)
    evidence_type = Column(String, nullable=True)
    confidence = Column(Float, nullable=True)
    user_response = Column(String, nullable=True)
    user_note = Column(Text, nullable=True)

    document = relationship("Document", back_populates="evidences")


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="reviewer")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    oauth_json = Column(JSON, nullable=True)


class ProjectMember(Base):
    __tablename__ = "project_members"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    role = Column(String, default="reviewer")
    blind_label = Column(String, nullable=True)

    __table_args__ = (Index("ix_project_members_project_user", "project_id", "user_id", unique=True),)


class EvidenceComment(Base):
    __tablename__ = "evidence_comments"

    id = Column(String, primary_key=True)
    evidence_id = Column(String, ForeignKey("evidences.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    body = Column(Text, nullable=False)
    mentions = Column(JSON, default=list)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=True)
    action = Column(String, nullable=False)
    detail_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(String, primary_key=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False, index=True)
    chunk_index = Column(Integer, default=0)
    text = Column(Text, nullable=False)
    embedding = Column(JSON, nullable=True)

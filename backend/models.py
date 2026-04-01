import datetime
from sqlalchemy import Column, String, Integer, Float, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(String, primary_key=True)
    mode = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    documents = relationship("Document", back_populates="project", cascade="all, delete-orphan")
    coding_scheme_items = relationship("CodingSchemeItem", back_populates="project", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    filename = Column(String, nullable=False)
    page_count = Column(Integer, default=0)
    status = Column(String, default="pending")
    file_path = Column(String, nullable=True)

    project = relationship("Project", back_populates="documents")
    labels = relationship("DocumentLabel", back_populates="document", cascade="all, delete-orphan")
    evidences = relationship("Evidence", back_populates="document", cascade="all, delete-orphan")


class CodingSchemeItem(Base):
    __tablename__ = "coding_scheme_items"

    id = Column(String, primary_key=True)
    project_id = Column(String, ForeignKey("projects.id"), nullable=False)
    code = Column(String, nullable=False)
    description = Column(String, nullable=False)
    category = Column(String, nullable=True)

    project = relationship("Project", back_populates="coding_scheme_items")


class DocumentLabel(Base):
    __tablename__ = "document_labels"

    id = Column(String, primary_key=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False)
    scheme_item_id = Column(String, ForeignKey("coding_scheme_items.id"), nullable=False)
    value = Column(String, default="Unclear")
    confidence = Column(Float, nullable=True)
    user_override = Column(String, nullable=True)

    document = relationship("Document", back_populates="labels")


class Evidence(Base):
    __tablename__ = "evidences"

    id = Column(String, primary_key=True)
    document_id = Column(String, ForeignKey("documents.id"), nullable=False)
    text = Column(Text, nullable=False)
    page = Column(Integer, nullable=False)
    bbox_json = Column(JSON, nullable=True)
    relevant_code_ids = Column(JSON, default=list)
    user_response = Column(String, nullable=True)
    user_note = Column(Text, nullable=True)

    document = relationship("Document", back_populates="evidences")

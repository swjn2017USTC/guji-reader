from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, HttpUrl


class WorkSource(BaseModel):
    provider: Literal["wikisource"] = "wikisource"
    url: HttpUrl
    retrievedAt: datetime


class VolumeRef(BaseModel):
    id: str
    workId: str
    title: str
    order: int = Field(ge=0)
    sourcePage: HttpUrl
    passageCount: int = Field(ge=0)


class Work(BaseModel):
    id: str
    title: str
    editionId: str
    source: WorkSource
    volumes: list[VolumeRef]


class Passage(BaseModel):
    id: str
    workId: str
    volumeId: str
    order: int = Field(ge=0)
    text: str = Field(min_length=1)
    sourcePage: HttpUrl
    revisionId: Optional[str] = None


class TextAnchor(BaseModel):
    passageId: str
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    exact: str = Field(min_length=1)
    prefix: str
    suffix: str


class SourceNote(BaseModel):
    id: str
    workId: str
    volumeId: str
    passageId: str
    anchor: TextAnchor
    text: str = Field(min_length=1)
    provenance: str


class AIAnnotation(BaseModel):
    id: str
    workId: str
    volumeId: str
    passageId: str
    anchor: TextAnchor
    layer: Literal[1, 2]
    category: str
    text: str = Field(min_length=1)
    confidence: Optional[float] = Field(default=None, ge=0.0, le=1.0)


class UserAnnotation(BaseModel):
    id: str
    workId: str
    editionId: str
    anchor: TextAnchor
    style: Literal["highlight", "wavy"]
    color: str
    opacity: float = Field(ge=0.0, le=1.0)
    note: str
    createdAt: datetime
    updatedAt: datetime

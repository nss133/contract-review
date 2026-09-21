from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class ReviewInput(ContractModel):
    text: str = Field(min_length=1, max_length=2000000)
    title: str = Field(default="", max_length=250)
    revision: int = Field(default=0, ge=0)

    @field_validator("text")
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError("Contract text is empty")
        return value  # Do not normalize source text or change evidence offsets.


class VerdictInput(ContractModel):
    verdict: Literal["이상없음", "검토의견"]
    comment: str = Field(default="", max_length=100000)
    reason: str = Field(default="", max_length=1000)
    origin: Literal["manual"] = "manual"
    revision: int = Field(ge=0)

    @model_validator(mode="after")
    def require_comment(self):
        if self.verdict == "검토의견" and not self.comment.strip():
            raise ValueError("Review comment required")
        return self


class EvidenceLocation(ContractModel):
    document_id: str = Field(min_length=1)
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    quote: str
    offset_unit: Literal["utf16"] = "utf16"

    @model_validator(mode="after")
    def ordered(self):
        if self.end < self.start:
            raise ValueError("Evidence range is reversed")
        return self


class AnalysisResult(ContractModel):
    engine_version: str
    knowledge_version: str
    input_revision: int = Field(ge=0)
    source_revision: int = Field(ge=0)
    clauses: List[Dict[str, Any]]
    core: Dict[str, Any]
    evidence: List[EvidenceLocation]


class JobStatus(ContractModel):
    id: str
    state: Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"]
    revision: int = Field(ge=0)
    step: str


class ErrorDetail(ContractModel):
    code: str
    message: str
    retryable: bool = False


class ErrorResponse(ContractModel):
    api_version: Literal["1"] = "1"
    request_id: str
    error: ErrorDetail


class LoginInput(ContractModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=1024)


class DraftInput(ContractModel):
    text: str = Field(max_length=100000)
    revision: int = Field(ge=0)


class MemberInput(ContractModel):
    user_id: str = Field(min_length=1, max_length=80)
    permission: Literal["read", "edit"]


class HealthResponse(ContractModel):
    api_version: Literal["1"] = "1"
    request_id: str
    status: Literal["ok"] = "ok"
    ready: bool
    scope: Literal["foundation"] = "foundation"


class CapabilitiesResponse(ContractModel):
    api_version: Literal["1"] = "1"
    request_id: str
    python_version: str
    fastapi_version: str
    database: Literal["sqlite"] = "sqlite"
    baseline_version: Literal["1.90.8"] = "1.90.8"
    features: Dict[str, bool]
    file_formats: List[str] = Field(default_factory=list)

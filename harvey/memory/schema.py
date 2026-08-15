from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class Entity(BaseModel):
    type: str
    value: str


class MemorySnippet(BaseModel):
    """Intent-tagged memory snippet (STITCH ι_t = (σ, ε, κ))."""

    id: int
    timestamp: datetime
    user_input: str
    rewritten_input: str | None = None
    llm_response: str
    thematic_scope: str
    event_types: list[str] = Field(default_factory=list)
    entity_types: list[str] = Field(default_factory=list)
    entities: list[Entity] = Field(default_factory=list)
    context: dict = Field(default_factory=dict)
    source_urls: list[str] = Field(default_factory=list)
    canonical_summary: str = ""

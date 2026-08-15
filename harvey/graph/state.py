from __future__ import annotations

from typing import Any, Literal, TypedDict


class Entity(TypedDict):
    type: str
    value: str


class ToolTrace(TypedDict):
    tool_name: str
    tool_input: str
    duration_ms: int
    output: str | None
    error: str | None


class ToolJob(TypedDict, total=False):
    intent: str
    tool_name: str
    tool_input: str
    ticker: str
    time_from: str | None
    time_to: str | None


class HarveyState(TypedDict, total=False):
    user_input: str
    previous_turn: dict[str, Any]
    thematic_scope: str
    intents: list[str]
    entities: list[Entity]
    retrieved_memories: list[dict[str, Any]]
    tool_jobs: list[ToolJob]
    tool_results: dict[str, Any]
    prompt_parts: list[str]
    all_tool_calls: list[ToolTrace]
    source_urls: list[str]
    response: str
    command: str | None
    research_mode: Literal["long-term", "short-term", "risk", "macro"]
    table: dict[str, Any] | None

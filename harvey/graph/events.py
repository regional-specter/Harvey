from __future__ import annotations

from typing import Any, Literal, TypedDict

UiEventType = Literal[
    "tool_start",
    "tool_detail",
    "tool_done",
    "thought",
    "answer",
    "table",
    "error",
]


class UiEvent(TypedDict, total=False):
    type: UiEventType
    name: str
    args: str
    detail: str
    duration_ms: int
    error: str
    text: str
    headers: list[str]
    rows: list[list[str]]


def event(type_: UiEventType, **payload: Any) -> UiEvent:
    return {"type": type_, **payload}

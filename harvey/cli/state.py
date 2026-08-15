from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

ResearchMode = Literal["long-term", "short-term", "risk", "macro"]


@dataclass
class ToolTrace:
    name: str
    args: str
    details: list[str] = field(default_factory=list)
    error: str | None = None
    running: bool = False
    duration_ms: int | None = None


@dataclass
class TableData:
    headers: list[str]
    rows: list[list[str]]


@dataclass
class Turn:
    query: str
    tools: list[ToolTrace] = field(default_factory=list)
    thought: str | None = None
    answer: str | None = None
    table: TableData | None = None
    complete: bool = False


@dataclass
class UiState:
    input_text: str = ""
    cursor: int = 0
    turns: list[Turn] = field(default_factory=list)
    running: bool = False
    ready: bool = True
    palette_open: bool = False
    palette_index: int = 0
    research_mode: ResearchMode = "long-term"
    cwd_label: str = ""
    git_branch: str = "HEAD"
    model_label: str = "Google: Gemini Flash"
    history: list[str] = field(default_factory=list)
    history_index: int | None = None

    @property
    def home(self) -> bool:
        return not self.turns

    @property
    def active_turn(self) -> Turn | None:
        if not self.turns:
            return None
        return self.turns[-1]

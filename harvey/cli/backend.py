"""Backends that yield UiEvent streams for the TUI."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable, Iterator
from typing import Any

from harvey.graph.events import UiEvent, event
from harvey.graph.run import run_turn

SEMICONDUCTOR_QUERY = (
    "Which semiconductor company has the best margin profile: AVGO, MRVL, AMD, or INTC?"
)

_MARGIN_TABLE = {
    "headers": ["Ticker", "Gross Margin", "Op Margin", "Net Margin"],
    "rows": [
        ["AVGO", "67.8%", "41.8%", "36.6%"],
        ["MRVL", "51.0%", "39.7%", "32.6%"],
        ["AMD", "49.5%", "12.6%", "12.5%"],
        ["INTC", "34.8%", "-3.8%", "-0.5%"],
    ],
}


def _sleep(seconds: float, step: float = 0.05) -> Iterator[None]:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        time.sleep(step)
        yield None


def iter_demo_events(query: str) -> Iterator[UiEvent | None]:
    lowered = query.lower()
    if query.startswith("/"):
        yield from _command_events(query)
        return
    if "margin" in lowered or "avgo" in lowered:
        yield from _semiconductor_events()
        return
    yield event("tool_start", name="Research", args=query[:80])
    for _ in _sleep(0.6):
        yield None
    yield event("tool_detail", name="Research", detail="Looked up 2 sources in 0.6s")
    yield event("thought", text="Working from the available data.")
    yield event("answer", text="Demo mode — canned traces only. Drop --demo to use live tools.")


def run_live_turn(
    query: str,
    emit: Callable[[UiEvent], None],
    *,
    previous_turn: dict[str, Any] | None = None,
    research_mode: str = "long-term",
) -> dict[str, Any]:
    return asyncio.run(
        run_turn(
            query,
            emit=emit,
            previous_turn=previous_turn,
            research_mode=research_mode,
        )
    )


def _semiconductor_events() -> Iterator[UiEvent | None]:
    yield event(
        "tool_start",
        name="Financials",
        args="Gross margin, operating margin, and net margin for AVGO, MRVL, AMD, INTC",
    )
    for _ in _sleep(0.8):
        yield None
    yield event("tool_detail", name="Financials", detail="Called 4 data sources in 7.3s")
    for _ in _sleep(0.9):
        yield None
    yield event("tool_detail", name="Financials", detail="Called 4 data sources in 18.5s")
    yield event(
        "thought",
        text="Let me get the actual margin percentages for a cleaner comparison.",
    )
    yield event("answer", text="AVGO wins across the board. It's not particularly close.")
    yield event("table", **_MARGIN_TABLE)


def _command_events(query: str) -> Iterator[UiEvent | None]:
    cmd = query.split()[0][1:].lower()
    yield event("thought", text=f"Running /{cmd}")
    for _ in _sleep(0.25):
        yield None
    messages = {
        "summary": "No memories yet — the STITCH store is empty in demo mode.",
        "export": "Nothing to export. Memory persistence lands with the LangGraph port.",
        "clear-mem": "Memory cleared (demo: there was nothing to clear).",
        "help": "Commands: /summary  /export  /clear-mem  /help  /quit. Ctrl+Q exits.",
        "quit": "Exiting.",
        "exit": "Exiting.",
    }
    yield event("answer", text=messages.get(cmd, f"Unknown command: /{cmd}"))

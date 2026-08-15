from __future__ import annotations

from collections.abc import Callable
from typing import Any

from harvey.graph.events import UiEvent
from harvey.graph.graph import get_graph
from harvey.graph.state import HarveyState


async def run_turn(
    user_input: str,
    *,
    emit: Callable[[UiEvent], None],
    previous_turn: dict[str, Any] | None = None,
    research_mode: str = "long-term",
) -> HarveyState:
    graph = get_graph()
    initial: HarveyState = {
        "user_input": user_input,
        "previous_turn": previous_turn or {},
        "research_mode": research_mode,  # type: ignore[typeddict-item]
        "thematic_scope": "",
        "intents": [],
        "entities": [],
        "retrieved_memories": [],
        "tool_jobs": [],
        "tool_results": {},
        "prompt_parts": [],
        "all_tool_calls": [],
        "source_urls": [],
        "response": "",
        "command": None,
        "table": None,
    }
    result = await graph.ainvoke(initial, config={"configurable": {"emit": emit}})
    return result  # type: ignore[return-value]

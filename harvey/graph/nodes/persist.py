from __future__ import annotations

from typing import Any

from harvey.graph.state import HarveyState
from harvey.memory.store import get_store


def persist_memory(state: HarveyState) -> dict[str, Any]:
    if state.get("command"):
        return {}
    store = get_store()
    store.append(
        {
            "user_input": state.get("user_input") or "",
            "llm_response": state.get("response") or "",
            "thematic_scope": state.get("thematic_scope") or "general_chat",
            "intents": list(state.get("intents") or []),
            "event_types": list(state.get("intents") or []),
            "entities": list(state.get("entities") or []),
            "context": state.get("tool_results") or {},
            "source_urls": list(state.get("source_urls") or []),
            "canonical_summary": (state.get("response") or "")[:500],
        }
    )
    store.save()
    return {}

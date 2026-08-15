from __future__ import annotations

from typing import Any

from harvey.graph.state import HarveyState
from harvey.memory.retriever import retrieve_relevant_memories
from harvey.memory.store import get_store


def retrieve_memory(state: HarveyState) -> dict[str, Any]:
    store = get_store()
    hits = retrieve_relevant_memories(
        store.all(),
        thematic_scope=state.get("thematic_scope") or "",
        entities=list(state.get("entities") or []),
        limit=3,
    )
    return {"retrieved_memories": hits}

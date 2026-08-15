from __future__ import annotations

from typing import Any


def retrieve_relevant_memories(
    entries: list[dict[str, Any]],
    *,
    thematic_scope: str = "",
    entities: list[dict[str, str]] | None = None,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """JS retriever: scope equality OR entity-value overlap, then last `limit` chronological hits."""
    entities = entities or []
    scope = (thematic_scope or "").lower()
    current_values = [str(e.get("value") or "").lower() for e in entities if e.get("value")]
    if not scope and not current_values:
        return []

    hits: list[dict[str, Any]] = []
    for memory in entries:
        mem_scope = str(memory.get("thematic_scope") or "").lower()
        if scope and mem_scope == scope:
            hits.append(memory)
            continue
        mem_values = [
            str(item.get("value") or "").lower()
            for item in (memory.get("entities") or [])
            if isinstance(item, dict)
        ]
        if current_values and any(value in mem_values for value in current_values):
            hits.append(memory)

    hits.sort(key=lambda item: str(item.get("timestamp") or ""))
    return hits[-limit:]

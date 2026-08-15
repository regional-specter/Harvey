from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from harvey.memory.schema import Entity, MemorySnippet

DEFAULT_PATH = Path(__file__).resolve().parent / "memory.json"


class MemoryStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or DEFAULT_PATH
        self.entries: list[dict[str, Any]] = []
        self.next_id = 1

    def load(self) -> list[dict[str, Any]]:
        try:
            if not self.path.exists():
                self.entries = []
                self.next_id = 1
                return self.entries
            raw = self.path.read_text(encoding="utf-8").strip()
            self.entries = json.loads(raw) if raw else []
            if not isinstance(self.entries, list):
                self.entries = []
            max_id = max((entry.get("id") or 0) for entry in self.entries) if self.entries else 0
            self.next_id = int(max_id) + 1
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            self.entries = []
            self.next_id = 1
        return self.entries

    def append(self, data: dict[str, Any]) -> dict[str, Any]:
        entities = [
            {"type": e["type"], "value": e["value"]}
            if isinstance(e, dict)
            else {"type": e.type, "value": e.value}
            for e in (data.get("entities") or [])
        ]
        event_types = list(data.get("event_types") or data.get("intents") or [])
        entry = {
            "id": self.next_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "user_input": data.get("user_input") or "",
            "rewritten_input": data.get("rewritten_input"),
            "llm_response": data.get("llm_response") or "",
            "thematic_scope": data.get("thematic_scope") or "general_chat",
            "event_type": event_types[0] if event_types else "chat_turn",
            "event_types": event_types,
            "entity_types": list({e["type"] for e in entities}),
            "entities": entities,
            "context": data.get("context") or {},
            "source_urls": data.get("source_urls") or [],
            "canonical_summary": data.get("canonical_summary") or "",
        }
        MemorySnippet(
            id=entry["id"],
            timestamp=datetime.fromisoformat(entry["timestamp"]),
            user_input=entry["user_input"],
            rewritten_input=entry.get("rewritten_input"),
            llm_response=entry["llm_response"],
            thematic_scope=entry["thematic_scope"],
            event_types=entry["event_types"],
            entity_types=entry["entity_types"],
            entities=[Entity(**e) for e in entities],
            context=entry["context"],
            source_urls=entry["source_urls"],
            canonical_summary=entry["canonical_summary"],
        )
        self.next_id += 1
        self.entries.append(entry)
        return entry

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(self.entries, indent=2), encoding="utf-8")

    def clear(self) -> None:
        self.entries = []
        self.next_id = 1
        self.save()

    def all(self) -> list[dict[str, Any]]:
        return list(self.entries)


_store: MemoryStore | None = None


def get_store() -> MemoryStore:
    global _store
    if _store is None:
        _store = MemoryStore()
        _store.load()
    return _store

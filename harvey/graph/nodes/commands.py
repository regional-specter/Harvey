from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from harvey.graph.emit import get_emit
from harvey.graph.events import event
from harvey.graph.state import HarveyState
from harvey.memory.store import get_store
from harvey.prompts.answer import SYSTEM_CHAT

HELP_TEXT = (
    "Commands: /summary  /export  /clear-mem  /help  /quit. "
    "Tab cycles research mode. Ctrl+Q or Ctrl+C exits."
)


async def command_handler(state: HarveyState, config: RunnableConfig) -> dict[str, Any]:
    emit = get_emit(config)
    cmd = (state.get("command") or "").lower()
    store = get_store()

    if cmd == "help":
        text = HELP_TEXT
    elif cmd in ("quit", "exit", "q"):
        text = "Exiting."
    elif cmd == "clear-mem":
        store.clear()
        text = "Memory has been cleared."
    elif cmd == "export":
        entries = store.all()
        if not entries:
            text = "No memories to export."
        else:
            stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
            path = Path.cwd() / f"memory_export_{stamp}.json"
            path.write_text(json.dumps(entries, indent=2), encoding="utf-8")
            text = f"Memories exported to {path.name}"
    elif cmd == "summary":
        emit(event("thought", text="Summarizing stored research."))
        entries = store.all()
        if not entries:
            text = "No memories yet."
        else:
            notes = []
            for entry in entries[-12:]:
                notes.append(
                    f"- ({entry.get('thematic_scope')}) {entry.get('user_input')} → "
                    f"{str(entry.get('llm_response') or '')[:240]}"
                )
            try:
                from harvey.llm import get_llm

                llm = get_llm(temperature=0.2)
                message = await llm.ainvoke(
                    [
                        SystemMessage(content=SYSTEM_CHAT),
                        HumanMessage(
                            content="Summarize our current conversation and learning.\n\n"
                            + "\n".join(notes)
                        ),
                    ]
                )
                text = str(getattr(message, "content", message)).strip()
            except Exception as exc:  # noqa: BLE001
                text = f"Could not summarize memory: {exc}"
    else:
        text = f"Unknown command: /{cmd}. Type /help for available commands."

    emit(event("answer", text=text))
    return {"response": text}

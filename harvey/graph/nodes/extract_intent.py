from __future__ import annotations

from typing import Any

from langchain_core.runnables import RunnableConfig

from harvey.graph.emit import get_emit
from harvey.graph.events import event
from harvey.graph.state import HarveyState
from harvey.prompts.extract import (
    ExtractedIntent,
    extraction_prompt,
    normalize_entities,
    normalize_intents,
)


FALLBACK = {
    "thematic_scope": "general_chat",
    "entities": [],
    "intents": ["general_conversation"],
}


async def extract_intent(state: HarveyState, config: RunnableConfig) -> dict[str, Any]:
    emit = get_emit(config)
    emit(event("thought", text="Figuring out what to look up."))
    user_input = (state.get("user_input") or "").strip()
    previous = state.get("previous_turn") or {}
    prompt = extraction_prompt(user_input, previous)

    try:
        from harvey.llm import get_llm

        llm = get_llm(temperature=0).with_structured_output(ExtractedIntent)
        extracted = await llm.ainvoke(prompt)
    except Exception as exc:
        emit(event("thought", text=f"Intent extraction failed ({exc.__class__.__name__}); using general chat."))
        return dict(FALLBACK)

    if extracted is None:
        return dict(FALLBACK)

    if isinstance(extracted, dict):
        intents = normalize_intents(extracted.get("intents"), extracted.get("event_type"))
        entities = normalize_entities(extracted.get("entities"))
        scope = extracted.get("thematic_scope") or "general_chat"
    else:
        intents = normalize_intents(list(extracted.intents))
        entities = normalize_entities(extracted.entities)
        scope = extracted.thematic_scope or "general_chat"
    if not intents:
        return dict(FALLBACK)
    return {
        "thematic_scope": scope,
        "intents": intents,
        "entities": entities,
    }

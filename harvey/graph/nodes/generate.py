from __future__ import annotations

import random
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from harvey.graph.emit import get_emit
from harvey.graph.events import event
from harvey.graph.state import HarveyState
from harvey.prompts.answer import PRICE_TEMPLATES, SYSTEM_CHAT, SYSTEM_GROUNDED, grounded_user_prompt


def _memory_lines(memories: list[dict[str, Any]]) -> list[str]:
    lines: list[str] = []
    for memory in memories:
        scope = memory.get("thematic_scope") or ""
        text = memory.get("canonical_summary") or memory.get("llm_response") or ""
        snippet = str(text).strip().replace("\n", " ")
        if len(snippet) > 280:
            snippet = snippet[:277] + "..."
        lines.append(f"- [{scope}] {snippet}")
    return lines


async def generate_answer(state: HarveyState, config: RunnableConfig) -> dict[str, Any]:
    emit = get_emit(config)
    user_input = state.get("user_input") or ""
    intents = state.get("intents") or []
    results = state.get("tool_results") or {}
    parts = list(state.get("prompt_parts") or [])
    memories = _memory_lines(list(state.get("retrieved_memories") or []))

    if len(intents) == 1 and intents[0] == "data_request" and results.get("price"):
        price = results["price"]
        text = random.choice(PRICE_TEMPLATES).format(ticker=price["ticker"], price=price["price"])
        emit(event("answer", text=text))
        return {"response": text}

    emit(event("thought", text="Summarizing the data."))
    try:
        from harvey.llm import get_llm

        llm = get_llm(temperature=0.2)
        if parts:
            prompt = grounded_user_prompt(user_input, parts, memories or None)
            message = await llm.ainvoke(
                [SystemMessage(content=SYSTEM_GROUNDED), HumanMessage(content=prompt)]
            )
        else:
            chat_prompt = user_input
            if memories:
                chat_prompt = (
                    "Prior research notes:\n"
                    + "\n".join(memories)
                    + "\n\nUser:\n"
                    + user_input
                )
            message = await llm.ainvoke(
                [SystemMessage(content=SYSTEM_CHAT), HumanMessage(content=chat_prompt)]
            )
        text = getattr(message, "content", None) or str(message)
        if isinstance(text, list):
            text = "".join(
                block.get("text", "") if isinstance(block, dict) else str(block) for block in text
            )
        text = str(text).strip()
    except Exception as exc:  # noqa: BLE001
        text = f"Could not generate an answer: {exc}"

    emit(event("answer", text=text))
    return {"response": text}

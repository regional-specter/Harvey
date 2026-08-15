from __future__ import annotations

from typing import Any, Callable

from langchain_core.runnables import RunnableConfig

from harvey.graph.events import UiEvent

EmitFn = Callable[[UiEvent], None]


def get_emit(config: RunnableConfig | None) -> EmitFn:
    if not config:
        return lambda _event: None
    configurable = config.get("configurable") or {}
    emit = configurable.get("emit")
    if callable(emit):
        return emit
    return lambda _event: None

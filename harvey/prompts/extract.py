from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from harvey.graph.state import Entity

INTENT_VALUES = (
    "data_request",
    "news_request",
    "earnings_request",
    "filing_request",
    "financial_query",
    "factual_question",
    "creative_request",
    "user_feedback",
    "greeting",
    "general_conversation",
)

ENTITY_TYPES = (
    "STOCK_TICKER",
    "COMPANY_NAME",
    "FINANCIAL_METRIC",
    "ECONOMIC_INDICATOR",
    "DATE_FROM",
    "DATE_TO",
)


class ExtractedEntity(BaseModel):
    type: str = Field(description="One of: " + ", ".join(ENTITY_TYPES))
    value: str


class ExtractedIntent(BaseModel):
    thematic_scope: str
    intents: list[str] = Field(description="One or more of: " + ", ".join(INTENT_VALUES))
    entities: list[ExtractedEntity] = Field(default_factory=list)


def extraction_prompt(user_input: str, previous_turn: dict, today: datetime | None = None) -> str:
    today = today or datetime.now()
    today_label = today.strftime("%B %d, %Y")
    prev_user = (previous_turn or {}).get("user_input") or "N/A"
    prev_agent = (previous_turn or {}).get("llm_response") or "N/A"
    return f"""Analyze the "Current User Query" to determine its thematic scope, key financial entities, and ALL intended actions.
Use the "Previous Turn" for context to resolve pronouns (like 'it', 'that', 'they') and understand follow-up questions.

--- Previous Turn (Context) ---
User: "{prev_user}"
Agent: "{prev_agent}"
---

--- Current User Query ---
"{user_input}"
---

Instructions:
1. Thematic Scope: Summarize the user's core goal. Examples: "company overview", "stock price analysis", "understanding financial metric", "general chat".
2. Entities: Identify key financial entities from the Current User Query. If the query uses a pronoun, infer the entity from the Previous Turn.
   Valid entity types: {", ".join(ENTITY_TYPES)}.
   For news_request, earnings_request, and filing_request you MUST extract the relevant STOCK_TICKER if present.
   If a date, year, or date range is specified, extract DATE_FROM and DATE_TO as YYYYMMDDTHHMM.
   Relative dates and year-only ranges must be computed against the current date ({today_label}).
   A year like "2024" becomes DATE_FROM 20240101T0000 and DATE_TO 20241231T2359.
3. Intents: Identify ALL distinct actions and return them as an array.
   Valid intents: {", ".join(INTENT_VALUES)}.
   news_request: news, headlines, or updates on a company/ticker.
   earnings_request: earnings, revenue, profit, EPS, or period performance.
   filing_request: SEC filings such as 10-K, 10-Q, 8-K.
   data_request: live market data such as current stock price.
   Example: "What is AAPL's stock price and latest news?" -> ["data_request", "news_request"]
   Example: "Show me TSLA's earnings and recent SEC filings" -> ["earnings_request", "filing_request"]
   Example: "Hello, how are you?" -> ["greeting"]

Return only structured fields. intents MUST be a non-empty array.
"""


def normalize_entities(raw: list | dict | None) -> list[Entity]:
    if raw is None:
        return []
    if isinstance(raw, dict):
        out: list[Entity] = []
        for key, value in raw.items():
            if value is None:
                continue
            if isinstance(value, list):
                out.extend({"type": str(key), "value": str(item)} for item in value if item is not None)
            else:
                out.append({"type": str(key), "value": str(value)})
        return out
    normalized: list[Entity] = []
    for item in raw:
        if isinstance(item, dict) and item.get("type") and item.get("value") is not None:
            normalized.append({"type": str(item["type"]), "value": str(item["value"])})
        elif hasattr(item, "type") and hasattr(item, "value"):
            normalized.append({"type": str(item.type), "value": str(item.value)})
    return normalized


def normalize_intents(raw: list | str | None, event_type: str | None = None) -> list[str]:
    if isinstance(raw, list) and raw:
        return [str(item) for item in raw]
    if isinstance(raw, str) and raw:
        return [raw]
    if event_type:
        return [event_type]
    return ["general_conversation"]

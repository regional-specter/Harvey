from __future__ import annotations

import os

from langchain_google_genai import ChatGoogleGenerativeAI

DEFAULT_MODEL = os.environ.get("HARVEY_MODEL", "gemini-flash-latest")


def get_llm(*, temperature: float = 0.2) -> ChatGoogleGenerativeAI:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY is not set in the environment or .env")
    return ChatGoogleGenerativeAI(
        model=DEFAULT_MODEL,
        google_api_key=api_key,
        temperature=temperature,
    )

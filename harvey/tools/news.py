"""Alpha Vantage NEWS_SENTIMENT."""

from __future__ import annotations

import os
from typing import Any

import httpx


def format_article(article: dict[str, Any]) -> str:
    """Map Alpha Vantage fields (title / source / summary), not the JS source.name bug."""
    title = article.get("title") or "Untitled"
    source = article.get("source")
    if isinstance(source, dict):
        source = source.get("name") or source.get("source")
    source = source or "unknown"
    summary = article.get("summary") or article.get("description") or ""
    return f"- {title} ({source}): {summary}"


def article_url(article: dict[str, Any]) -> str | None:
    url = article.get("url")
    return url if isinstance(url, str) and url else None


async def fetch_news(
    ticker: str,
    *,
    time_from: str | None = None,
    time_to: str | None = None,
    limit: int = 5,
) -> list[dict[str, Any]] | None:
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        return None

    params: dict[str, str | int] = {
        "function": "NEWS_SENTIMENT",
        "tickers": ticker,
        "limit": limit,
        "apikey": api_key,
    }
    if time_from:
        params["time_from"] = time_from
    if time_to:
        params["time_to"] = time_to

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get("https://www.alphavantage.co/query", params=params)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    if data.get("Note"):
        raise RuntimeError(str(data["Note"]))
    if data.get("Information"):
        raise RuntimeError(str(data["Information"]))

    feed = data.get("feed")
    if isinstance(feed, list):
        return feed
    return None

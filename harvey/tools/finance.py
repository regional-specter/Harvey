"""Alpha Vantage GLOBAL_QUOTE."""

from __future__ import annotations

import os

import httpx


async def fetch_stock_price(ticker: str) -> float | None:
    api_key = os.environ.get("ALPHA_VANTAGE_API_KEY")
    if not api_key:
        return None

    url = "https://www.alphavantage.co/query"
    params = {
        "function": "GLOBAL_QUOTE",
        "symbol": ticker,
        "apikey": api_key,
    }

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError):
        return None

    if data.get("Note"):
        raise RuntimeError(str(data["Note"]))
    if data.get("Information"):
        raise RuntimeError(str(data["Information"]))

    quote = data.get("Global Quote") or {}
    price = quote.get("05. price")
    if price:
        try:
            return float(price)
        except (TypeError, ValueError):
            return None
    return None

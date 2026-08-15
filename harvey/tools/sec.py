"""SEC EDGAR helpers, with a required User-Agent."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx

CIK_TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_RATE_LIMIT_INTERVAL = 0.1
USER_AGENT = os.environ.get(
    "SEC_USER_AGENT",
    "Harvey-Research-Agent/0.2 (contact: harvey@example.com)",
)

_cik_map: dict[str, str] | None = None
_last_sec_request = 0.0
_rate_lock = asyncio.Lock()


async def _rate_limit() -> None:
    global _last_sec_request
    async with _rate_lock:
        now = time.monotonic()
        wait = SEC_RATE_LIMIT_INTERVAL - (now - _last_sec_request)
        if wait > 0:
            await asyncio.sleep(wait)
        _last_sec_request = time.monotonic()


def _headers() -> dict[str, str]:
    return {"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"}


async def load_cik_ticker_map() -> dict[str, str]:
    global _cik_map
    if _cik_map is not None:
        return _cik_map

    await _rate_limit()
    try:
        async with httpx.AsyncClient(timeout=30.0, headers=_headers()) as client:
            response = await client.get(CIK_TICKER_MAP_URL)
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise RuntimeError(f"Failed to load SEC CIK map: {exc}") from exc

    mapping: dict[str, str] = {}
    entries = data if isinstance(data, list) else list(data.values())
    for entry in entries:
        if not entry or not entry.get("ticker") or entry.get("cik_str") is None:
            continue
        cik = str(entry["cik_str"]).zfill(10)
        mapping[str(entry["ticker"]).upper()] = cik

    _cik_map = mapping
    return mapping


async def get_cik(ticker: str) -> str | None:
    mapping = await load_cik_ticker_map()
    return mapping.get(ticker.upper())


async def fetch_company_facts(cik: str) -> dict[str, Any] | None:
    if not cik:
        return None
    await _rate_limit()
    url = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
    try:
        async with httpx.AsyncClient(timeout=30.0, headers=_headers()) as client:
            response = await client.get(url)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        return None


async def fetch_submission_metadata(cik: str) -> dict[str, Any] | None:
    if not cik:
        return None
    await _rate_limit()
    url = f"https://data.sec.gov/submissions/CIK{cik}.json"
    try:
        async with httpx.AsyncClient(timeout=30.0, headers=_headers()) as client:
            response = await client.get(url)
            if response.status_code == 404:
                return None
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError):
        return None


async def fetch_earnings_eps(ticker: str) -> dict[str, Any] | None:
    """CIK + companyfacts + most recent diluted EPS. Null-safe vs the JS loop."""
    cik = await get_cik(ticker)
    if not cik:
        return None
    company_facts = await fetch_company_facts(cik)
    if not company_facts:
        return None
    gaap = ((company_facts.get("facts") or {}).get("us-gaap") or {})
    eps_tree = gaap.get("EarningsPerShareDiluted") or {}
    units = eps_tree.get("units") or {}
    usd = units.get("USD/shares") or units.get("USD") or []
    if not usd:
        for values in units.values():
            if isinstance(values, list):
                usd = values
                break
    recent = [fact for fact in usd if fact.get("form") in ("10-K", "10-Q") and fact.get("end")]
    if not recent:
        return {"cik": cik, "most_recent": None}
    recent.sort(key=lambda fact: str(fact.get("end")), reverse=True)
    return {"cik": cik, "most_recent": recent[0]}


async def fetch_recent_filings(ticker: str, limit: int = 5) -> dict[str, Any] | None:
    """CIK + submissions; first N form/date pairs (fixes the JS Object.keys index bug)."""
    cik = await get_cik(ticker)
    if not cik:
        return None
    metadata = await fetch_submission_metadata(cik)
    if not metadata:
        return {"cik": cik, "filings": []}
    recent = ((metadata.get("filings") or {}).get("recent")) or {}
    forms = recent.get("form") or []
    dates = recent.get("reportDate") or []
    lines = [
        f"- {form} filed on {date}."
        for form, date in zip(forms, dates, strict=False)
        if form
    ][:limit]
    return {"cik": cik, "filings": lines}

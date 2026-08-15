from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from langchain_core.runnables import RunnableConfig

from harvey.graph.emit import get_emit
from harvey.graph.events import event
from harvey.graph.state import HarveyState, ToolJob, ToolTrace
from harvey.tools.finance import fetch_stock_price
from harvey.tools.news import article_url, fetch_news, format_article
from harvey.tools.sec import fetch_earnings_eps, fetch_recent_filings


def _av_datetime(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M")


def _take_entity(available: list[dict[str, str]], entity_type: str) -> dict[str, str] | None:
    for index, entity in enumerate(available):
        if entity.get("type") == entity_type and entity.get("value"):
            return available.pop(index)
    return None


def _ticker_for_intent(
    available: list[dict[str, str]], originals: list[dict[str, str]]
) -> dict[str, str] | None:
    """Prefer an unused ticker; if none remain, reuse the first ticker.

    The Node loop consumed each STOCK_TICKER once, so "AAPL price and latest news"
    skipped news unless the extractor duplicated the ticker.
    """
    taken = _take_entity(available, "STOCK_TICKER")
    if taken:
        return taken
    for entity in originals:
        if entity.get("type") == "STOCK_TICKER" and entity.get("value"):
            return dict(entity)
    return None


def route_tools(state: HarveyState) -> dict[str, Any]:
    """Map intents → tool jobs. Tickers may be reused across different tool types."""
    originals = [dict(entity) for entity in (state.get("entities") or [])]
    available = [dict(entity) for entity in originals]
    jobs: list[ToolJob] = []

    for intent in state.get("intents") or []:
        if intent == "data_request":
            ticker = _ticker_for_intent(available, originals)
            if not ticker:
                continue
            symbol = ticker["value"].upper()
            jobs.append(
                {
                    "intent": intent,
                    "tool_name": "fetchStockPrice",
                    "tool_input": f"stock price of {symbol}",
                    "ticker": symbol,
                }
            )
        elif intent == "news_request":
            ticker = _ticker_for_intent(available, originals)
            if not ticker:
                continue
            symbol = ticker["value"].upper()
            date_from = _take_entity(available, "DATE_FROM")
            date_to = _take_entity(available, "DATE_TO")
            if date_from and date_to:
                time_from, time_to = date_from["value"], date_to["value"]
            else:
                if date_from:
                    available.append(date_from)
                if date_to:
                    available.append(date_to)
                now = datetime.now(timezone.utc)
                time_from = _av_datetime(now - timedelta(hours=24))
                time_to = _av_datetime(now)
            jobs.append(
                {
                    "intent": intent,
                    "tool_name": "fetchNews",
                    "tool_input": f"latest news for {symbol}",
                    "ticker": symbol,
                    "time_from": time_from,
                    "time_to": time_to,
                }
            )
        elif intent == "earnings_request":
            ticker = _ticker_for_intent(available, originals)
            if not ticker:
                continue
            symbol = ticker["value"].upper()
            jobs.append(
                {
                    "intent": intent,
                    "tool_name": "fetchCompanyFacts",
                    "tool_input": f"earnings for {symbol}",
                    "ticker": symbol,
                }
            )
        elif intent == "filing_request":
            ticker = _ticker_for_intent(available, originals)
            if not ticker:
                continue
            symbol = ticker["value"].upper()
            jobs.append(
                {
                    "intent": intent,
                    "tool_name": "fetchSubmissionMetadata",
                    "tool_input": f"filings for {symbol}",
                    "ticker": symbol,
                }
            )

    return {"tool_jobs": jobs}


async def _execute_job(job: ToolJob) -> tuple[ToolTrace, dict[str, Any], list[str], str | None]:
    intent = job["intent"]
    ticker = job["ticker"]
    name = job["tool_name"]
    args = job["tool_input"]
    started = time.perf_counter()
    context: dict[str, Any] = {}
    urls: list[str] = []
    prompt_part: str | None = None
    output: str | None = None
    error: str | None = None

    try:
        if intent == "data_request":
            price = await fetch_stock_price(ticker)
            if price is not None:
                output = f"The current stock price of {ticker} is {price}."
                prompt_part = output
                context["price"] = {"ticker": ticker, "price": price}
            else:
                error = f"Could not retrieve stock price for {ticker}."
                prompt_part = error
        elif intent == "news_request":
            articles = await fetch_news(
                ticker,
                time_from=job.get("time_from"),
                time_to=job.get("time_to"),
                limit=5,
            )
            if articles:
                lines = "\n".join(format_article(article) for article in articles)
                output = f"Here are the latest news articles for {ticker}:\n{lines}"
                prompt_part = output
                context["news"] = {"ticker": ticker, "articles": articles}
                urls = [url for article in articles if (url := article_url(article))]
            else:
                error = (
                    f"No recent news found for {ticker} between "
                    f"{job.get('time_from')} and {job.get('time_to')}."
                )
                prompt_part = error
        elif intent == "earnings_request":
            payload = await fetch_earnings_eps(ticker)
            fact = (payload or {}).get("most_recent") if payload else None
            if fact:
                output = (
                    f"The most recent diluted EPS for {ticker} is {fact.get('val')} "
                    f"for the period ending {fact.get('end')}."
                )
                prompt_part = output
                context["earnings"] = {"ticker": ticker, "mostRecentFact": fact}
            elif payload is None:
                error = f"Could not retrieve company facts for {ticker}."
                prompt_part = error
            else:
                error = f"No recent EPS data found in company filings for {ticker}."
                prompt_part = error
        elif intent == "filing_request":
            payload = await fetch_recent_filings(ticker)
            filings = (payload or {}).get("filings") if payload else None
            if filings:
                output = f"Here are the most recent SEC filings for {ticker}:\n" + "\n".join(filings)
                prompt_part = output
                context["filings"] = {"ticker": ticker, "recentFilings": filings}
            elif payload is None:
                error = f"Could not retrieve submission metadata for {ticker}."
                prompt_part = error
            else:
                error = f"No recent filings found for {ticker}."
                prompt_part = error
        else:
            error = f"Unknown tool intent: {intent}"
    except Exception as exc:  # noqa: BLE001 — tool failures become traces, not crashes
        error = str(exc)
        prompt_part = f"I tried to run {name} for {ticker}, but it failed with the error: {exc}"

    duration_ms = int((time.perf_counter() - started) * 1000)
    trace: ToolTrace = {
        "tool_name": name,
        "tool_input": args,
        "duration_ms": duration_ms,
        "output": output,
        "error": error,
    }
    return trace, context, urls, prompt_part


async def run_tools(state: HarveyState, config: RunnableConfig) -> dict[str, Any]:
    emit = get_emit(config)
    jobs = list(state.get("tool_jobs") or [])
    if not jobs:
        return {"all_tool_calls": [], "prompt_parts": [], "tool_results": {}, "source_urls": []}

    for job in jobs:
        emit(event("tool_start", name=job["tool_name"], args=job["tool_input"]))

    settled = await asyncio.gather(*[_execute_job(job) for job in jobs], return_exceptions=True)

    traces: list[ToolTrace] = []
    prompt_parts: list[str] = []
    merged: dict[str, Any] = {}
    urls: list[str] = []

    for job, result in zip(jobs, settled, strict=False):
        if isinstance(result, Exception):
            duration_ms = 0
            trace: ToolTrace = {
                "tool_name": job["tool_name"],
                "tool_input": job["tool_input"],
                "duration_ms": duration_ms,
                "output": None,
                "error": str(result),
            }
            traces.append(trace)
            prompt_parts.append(
                f"I tried to run {job['tool_name']} for {job.get('ticker')}, but it failed with the error: {result}"
            )
            emit(
                event(
                    "tool_done",
                    name=job["tool_name"],
                    args=job["tool_input"],
                    duration_ms=duration_ms,
                    error=str(result),
                )
            )
            continue

        trace, context, job_urls, prompt_part = result
        traces.append(trace)
        merged.update(context)
        urls.extend(job_urls)
        if prompt_part:
            prompt_parts.append(prompt_part)
        seconds = trace["duration_ms"] / 1000
        if trace.get("error"):
            emit(
                event(
                    "tool_done",
                    name=job["tool_name"],
                    args=job["tool_input"],
                    duration_ms=trace["duration_ms"],
                    error=trace["error"],
                )
            )
        else:
            emit(
                event(
                    "tool_detail",
                    name=job["tool_name"],
                    args=job["tool_input"],
                    detail=f"in {seconds:.1f}s",
                )
            )
            emit(
                event(
                    "tool_done",
                    name=job["tool_name"],
                    args=job["tool_input"],
                    duration_ms=trace["duration_ms"],
                )
            )

    return {
        "all_tool_calls": traces,
        "prompt_parts": prompt_parts,
        "tool_results": merged,
        "source_urls": urls,
    }

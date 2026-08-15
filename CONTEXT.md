# Harvey — Project Context

This document is a reconstruction-grade specification of the current Harvey agent. It is written so the system can be reimplemented with **LangGraph** (control flow / state) and **LangChain** (LLM, tools, memory, prompts) without needing to reverse-engineer the Node.js codebase.

Harvey is a **financial research agent**. It answers questions about stocks, news, earnings, and SEC filings, then stores each turn as an **intent-tagged memory** rather than a vector RAG store. The design is inspired by the paper **[Grounding Agent Memory in Contextual Intent (STITCH)](https://arxiv.org/abs/2601.10702)** (Yang, Jiang, Jiang, Kargupta, Zhang, Han; ACL Findings 2026). The current codebase implements a **partial, finance-specialized STITCH prototype**, not the full paper system.

---

## 1. What Harvey is

Harvey is a terminal research assistant that:

1. Takes a natural-language finance question.
2. Extracts a **contextual intent** (thematic scope + intents + entities).
3. Dispatches **zero or more tools in parallel** based on those intents.
4. Grounds the final answer strictly in tool output (or a small template for simple price queries).
5. Persists the turn to a JSON memory file tagged with intent metadata.
6. Renders the conversation, tool traces, and tables in a **Python Rich TUI**.

The live codebase is Python: LangGraph for control flow, LangChain for LLM/tools/prompts, Rich for the TUI.

It is **not** a general chatbot, not a trading bot, and not a full RAG pipeline. The LLM is used as:

- an **intent parser** (structured JSON extraction)
- a **grounded summarizer** (must not invent facts beyond provided data)

It is **not** used as an autonomous planner that chooses tools via native function-calling. Tool routing is **deterministic**: intent labels map 1:1 to functions in `harvey/graph/nodes/tools_router.py`.

### Product thesis

Standard embedding retrieval mixes facts that look similar but belong to different research goals (e.g. AAPL as a long-term compounder vs AAPL as a short-term risk case). STITCH argues that each trajectory step should be indexed by a **contextual intent tuple** and retrieved by **intent compatibility**, not cosine similarity alone.

Harvey’s intended research modes (from `main.todo`, not yet enforced in code):

- long-term
- short-term
- risk
- macro

The current extractor instead emits free-text thematic scopes such as `"stock price inquiry"` or `"latest news"`.

---

## 2. Repository layout

```
Harvey/
├── README.md
├── CONTEXT.md                 # this file
├── main.todo                  # product roadmap
├── pyproject.toml
├── .gitignore
├── .env                       # not in repo; required at runtime
│
└── harvey/                    # Python agent + Rich TUI
    ├── __main__.py            # python -m harvey
    ├── cli/                   # Rich TUI
    ├── graph/                 # LangGraph state + nodes
    ├── tools/                 # Alpha Vantage + SEC
    ├── memory/                # STITCH store / retriever
    └── prompts/
```

---

## 3. Tech stack

### Target (Python rewrite)

| Concern | Choice |
|---|---|
| Language | Python 3.11+ |
| Orchestration | LangGraph `StateGraph` |
| LLM / tools / prompts | LangChain (`langchain-core`, `langchain-google-genai`) |
| Model | Gemini Flash (`gemini-flash-latest` or a pinned dated Flash) |
| Structured intent | Pydantic + `with_structured_output` |
| HTTP | `httpx` (async) |
| Env | `python-dotenv`, load once at process start from repo-root `.env` |
| TUI | `rich` (`Live`, `Layout`, `Panel`, `Table`, `Text`) — not Ink, not Textual |
| Persistence | JSON / SQLite memory store (STITCH snippets) |

### Legacy (Node, do not extend)

| Concern | Current choice |
|---|---|
| Language | JavaScript (CommonJS) |
| LLM SDK | `@google/genai` `^1.40.0` |
| Model | `models/gemini-flash-latest` |
| UI | React 19 + Ink 6, bundled with esbuild |
| Unused dep | `openai` `^6.18.0` is installed but never imported |

### External APIs

| Source | Auth | Used for |
|---|---|---|
| Google Gemini | `GEMINI_API_KEY` | intent extraction + final summary |
| Alpha Vantage | `ALPHA_VANTAGE_API_KEY` | live price + news/sentiment |
| SEC EDGAR | none (public) | CIK map, company facts (EPS), filing metadata |

No database, no vector store, no embeddings, no queue, no tests.

---

## 4. Runtime contract

### Environment variables

Create a `.env` at the **repository root**:

```
GEMINI_API_KEY=...
ALPHA_VANTAGE_API_KEY=...
```

`llm-client.js` loads `.env` with:

```js
require("dotenv").config({ path: path.join(__dirname, '../../.env') });
```

`finance_api.js` and `news_api.js` read `process.env.ALPHA_VANTAGE_API_KEY` at **module load time**. They do not call `dotenv` themselves. That works only if `llm-client.js` (or the UI) is imported first, or if the process already has the env vars. A LangGraph port should load env once at process start.

### Public agent API (`agent/index.js`)

```js
initializeAgent(): Promise<boolean>
handleUserInput(userInput: string): Promise<{
  response: string,
  toolCall: object | null,      // last tool call only
  allToolCalls?: object[]       // present on chat path; omitted on some commands
}>
setAgentLogger(loggerFunc: (msg: string) => void): void
```

`agent/index.d.ts` is stale: it types `handleUserInput` as `Promise<string>`. The UI actually destructures `{ response, allToolCalls }`.

### Slash commands

Parsed from the first token after `/`. Extra flags are ignored.

| Command | Behavior |
|---|---|
| `/summary` | Runs a full agent cycle with the prompt `"Summarize our current conversation and learning."` |
| `/export` | Writes `getMemoryEntries()` to `memory_export_<ISO>.json` in the **current working directory** |
| `/clear-mem` | Empties in-memory array and overwrites `agent/memory/memory.json` with `[]` |
| anything else | `"Unknown command: /X. Type '/help' (not yet implemented)..."` |

`/help` is mentioned but not implemented.

---

## 5. End-to-end turn lifecycle

This is the actual control flow today. Map each box to a LangGraph node.

```
                    ┌─────────────────────────┐
                    │  UI: user submits text  │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ handleUserInput         │
                    │  /command? → command    │
                    │  else → runAgentCycle   │
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ extractIntentAndEntities│  LLM call #1
                    │  → thematic_scope       │
                    │  → intents[]            │
                    │  → entities[]           │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │ for each intent, consume matching │
              │ unused entity and queue a tool    │
              └─────────────────┬─────────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ Promise.allSettled(tools)│  0..N HTTP calls
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ format tool results into│
                    │ augmentedPromptParts[]  │
                    │ + contextForMemory      │
                    │ + allToolCalls[]        │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              │ single data_request + price?      │
              │   YES → random English template   │
              │   NO  → generateResponse()        │  LLM call #2
              └─────────────────┬─────────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ appendMemory + saveMemory│
                    └───────────┬─────────────┘
                                │
                    ┌───────────▼─────────────┐
                    │ return {response,       │
                    │   toolCall, allToolCalls}│
                    └─────────────────────────┘
```

Important properties of this loop:

- **One user turn = one cycle.** No multi-step planner, no ReAct retry, no tool-result-then-think loop.
- **Tools run concurrently**, not sequentially.
- **Entities are consumed.** Each `STOCK_TICKER` can be used by at most one tool in a turn. If the user asks “AAPL price and AAPL news”, the extractor must emit **two** `STOCK_TICKER` entities, or the second tool will be skipped.
- **Memory retrieval is imported but never called.** `retrieveRelevantMemories` exists and is imported in `agent-loop.js`, but the cycle never uses it. Retrieved memories are not injected into the final prompt.
- **Previous-turn context is stubbed.** `extractIntentAndEntities(userInput, "")` is called with an empty string, so pronoun resolution (`"what about its P/E?"`) does not actually see the last turn.

---

## 6. STITCH: intended theory vs current implementation

Paper: *Grounding Agent Memory in Contextual Intent*, arXiv:2601.10702.

STITCH indexes each trajectory step with a contextual intent tuple:

```
ι_t = (σ_t, ε_t, κ_t)
```

| Symbol | Paper name | Meaning |
|---|---|---|
| `σ_t` | Thematic scope (partonomy) | Stable latent goal until a goal-boundary is detected. Example: `"long-term investing in AAPL"`. |
| `ε_t` | Event type (taxonomy) | Recurring action class. Paper induces labels online. Harvey uses a **fixed finance ontology**. |
| `κ_t` | Key entity types | Classes of attributes that matter under this intent (Price vs Rating, Metric vs Hyperparameter). |

Paper retrieval is **label-density ranking**: filter memories by overlap with `(scopes, event types, entity types)`, then break ties with semantic similarity. The point is to suppress semantically similar but **context-incompatible** history.

### What Harvey implemented

| STITCH component | Harvey status |
|---|---|
| Thematic scope extraction | Implemented as free-text string from Gemini |
| Event / intent labels | Implemented as a **closed list** of finance intents (see §7) |
| Entity types + values | Implemented as `{type, value}` objects |
| Memory snippet `m_t = (step, intent, summary)` | Partial: stores user input, LLM response, scope, entities, raw tool context. Does **not** store `intents[]`. `event_type` is hardcoded to `"chat_turn"`. |
| Scope continuity / boundary detection | Not implemented. Each turn independently invents a scope string. |
| Dynamic event taxonomy | Not implemented. Fixed enum. |
| Coreference rewrite via aligned memories | Prompted, but previous turn is not passed in. |
| Intent-compatible retrieval | Retriever exists (scope equality **or** entity-value overlap). Not wired into the loop. No label-density ranking. No embeddings. |
| Incremental memory revision / stitching | Not implemented. Turns are append-only. |
| Cross-intent access only on request | Not implemented. |
| Source URL attribution | News articles have URLs in raw context; they are not required on the memory schema. |

### What `main.todo` still wants (STITCH-faithful)

- Force explicit research intent before fetch: long-term / short-term / risk / macro.
- Block similarity retrieval across incompatible intents.
- Memory stitching: new facts update existing intent threads.
- Timeline of belief evolution per intent.
- Detect assumption breaks, contradictions, material changes.
- Source attribution (URL) on every stored item.
- Warn when the user mixes incompatible research intents.

A LangGraph rewrite should treat the **paper + todo** as the target architecture and the **current loop** as the working MVP to preserve.

---

## 7. Intent and entity ontologies

These are the closed vocabularies the extractor is instructed to emit. Recreate them as LangChain enums / Pydantic / Zod schemas.

### Intents (`intents: string[]`)

A single query may contain several. Order in the array is the order tools are queued.

| Intent | Tool | Trigger examples |
|---|---|---|
| `data_request` | `fetchStockPrice(ticker)` | “What’s AAPL trading at?” |
| `news_request` | `fetchNews(ticker, {from, to, limit: 5})` | “Latest news on MSFT” |
| `earnings_request` | `getCik` → `fetchCompanyFacts` → extract diluted EPS | “TSLA earnings / EPS” |
| `filing_request` | `getCik` → `fetchSubmissionMetadata` | “Recent 10-K / 10-Q for AMZN” |
| `financial_query` | none | qualitative investing questions |
| `factual_question` | none | general facts |
| `creative_request` | none | unused in practice |
| `user_feedback` | none | unused in practice |
| `greeting` | none | “hello” |
| `general_conversation` | none | fallback |

Only the first four intents dispatch tools. The rest fall through to the LLM with the raw user text (and no tool data).

### Entity types

| Type | Value format | Used by |
|---|---|---|
| `STOCK_TICKER` | `"AAPL"` | all four tools |
| `COMPANY_NAME` | `"Microsoft"` | stored, not used for routing |
| `FINANCIAL_METRIC` | e.g. `"P/E"` | stored, not used for routing |
| `ECONOMIC_INDICATOR` | e.g. `"inflation"` | stored, not used (FRED not integrated) |
| `DATE_FROM` | `YYYYMMDDTHHMM` | `news_request` window |
| `DATE_TO` | `YYYYMMDDTHHMM` | `news_request` window |

### Entity consumption algorithm

```
availableEntities = copy(extracted.entities)

for intent in intents:
  if intent needs a ticker:
    take the first remaining entity with type STOCK_TICKER and a truthy value
    if none: skip this intent
    if news_request:
      if both DATE_FROM and DATE_TO remain: use them and remove them
      else: default window = last 24 hours, formatted as YYYYMMDDTHHMM
    queue tool(ticker, ...)
    remove the consumed ticker from availableEntities
```

Default news window formatting:

```js
date.toISOString().replace(/[-:]|\..+/g, '').slice(0, 13)
// 2026-08-15T09:06:00.000Z → "20260815T0906"
```

### Extractor fallbacks

On parse failure or malformed JSON:

```js
{ thematic_scope: 'general_chat', entities: [], intents: ['general_conversation'] }
```

Normalizations already in code (keep these):

- `entities` may arrive as an object map `{ STOCK_TICKER: "AAPL" }` or `{ STOCK_TICKER: ["AAPL", "MSFT"] }`. Flatten to `[{type, value}, ...]`.
- `intents` may arrive as a string; wrap in an array.
- Legacy `event_type` string is accepted if `intents` is missing.

### Hardcoded extractor date

The extraction prompt currently says the current date is **February 21, 2026**. Relative dates (“yesterday”, “last week”, “last month”) are computed against that frozen date. A rewrite must inject **today’s real date**.

---

## 8. Tools / data sources (contracts)

Recreate these as LangChain `@tool` functions with the same I/O.

### 8.1 `fetchStockPrice(ticker: string) → number | null`

- **API:** `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol={ticker}&apikey={KEY}`
- **Success:** `parseFloat(data['Global Quote']['05. price'])`
- **Rate-limit / note:** if `data.Note` exists, return `null`
- **HTTP / parse / missing key:** return `null` (does not throw)
- **Agent-loop success text:** `"The current stock price of {ticker} is {price}."`
- **Memory context:** `context.price = { ticker, price }`

### 8.2 `fetchNews(ticker, { from, to, limit = 50 }) → object[] | null`

- **API:** `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers={ticker}&limit={limit}&apikey={KEY}`
- Optional: `&time_from={from}` `&time_to={to}`
- Agent loop always passes `limit: 5`
- **Success:** `data.feed` (array of Alpha Vantage news objects)
- **Failure:** `null`

Each article (observed in `UI/dist/memory.json`) includes at least:

```
title, url, time_published, authors[], summary, banner_image,
source, category_within_source, source_domain,
topics[{topic, relevance_score}],
overall_sentiment_score, overall_sentiment_label,
ticker_sentiment[{ticker, relevance_score, ticker_sentiment_score, ticker_sentiment_label}]
```

The loop currently formats only:

```
- {title} ({source.name}): {description}
```

Alpha Vantage’s feed uses `source` as a **string** and `summary` rather than `description` / `source.name`. That mismatch means titles may render as `undefined` unless the feed happens to include those fields. A rewrite should map:

```
title, source (string), summary
```

**Memory context:** `context.news = { ticker, articles }` (full objects, including sentiment). Sentiment is stored but not used in the answer prompt.

### 8.3 SEC helpers

Rate limit: **10 req/s** via a 100ms inter-request delay. CIK map is cached in process memory.

#### `getCik(ticker) → string | null`

- Load once: `https://www.sec.gov/files/company_tickers.json`
- Accepts array or `{ "0": {cik_str, ticker, title}, ... }`
- Returns 10-digit zero-padded CIK, e.g. `"0000320193"`
- Lookup is `ticker.toUpperCase()`

**SEC fair-access note:** the current client does **not** send a `User-Agent` with contact info. SEC EDGAR requires one. A rewrite should set e.g. `User-Agent: Harvey Research Agent (email@example.com)`.

#### `fetchCompanyFacts(cik) → object | null`

- `https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json`
- Agent extracts:

```
companyFacts.facts['us-gaap'].EarningsPerShareDiluted.units.USD
  .filter(fact => fact.form === '10-K' || fact.form === '10-Q')
  .sort by fact.end descending
  [0]
```

Success text:

```
The most recent diluted EPS for {ticker} is {val} for the period ending {end}.
```

Memory: `context.earnings = { ticker, mostRecentFact }`

The loop does **not** null-check `companyFacts` / `facts` / `us-gaap` before reading `EarningsPerShareDiluted`. Missing CIK or missing GAAP tree will throw and fail the whole cycle.

#### `fetchSubmissionMetadata(cik) → object | null`

- `https://data.sec.gov/submissions/CIK{cik}.json`
- Reads `filings.recent`, walks keys starting with `accessionNumber`, and pairs index `i` with `form[i]` and `reportDate[i]`
- Takes first 5 formatted lines: `"- {form} filed on {reportDate}."`

Memory: `context.filings = { ticker, recentFilings: string[] }`

### Tool-call metadata (UI contract)

Each settled tool produces:

```ts
{
  toolName: 'fetchStockPrice' | 'fetchNews' | 'fetchCompanyFacts' | 'fetchSubmissionMetadata',
  toolInput: string,          // human phrase, e.g. "stock price of AAPL"
  duration: number,           // ms
  output?: string,            // success text
  error?: string              // failure text
}
```

Returned to the UI as `allToolCalls`. `toolCall` is only the last item (legacy). The UI renders every item in `allToolCalls`.

---

## 9. Memory system

### Schema (`ChatMemorySchemaV1`)

Required fields validated by `isValidMemoryEntry`:

| Field | Type | Actual write behavior |
|---|---|---|
| `id` | number | autoincrement, starts at `max(existing)+1` |
| `timestamp` | ISO string | `new Date().toISOString()` |
| `user_input` | string | from the turn |
| `llm_response` | string | final answer |
| `thematic_scope` | string | from extractor, default `"general_chat"` |
| `event_type` | string | **always defaulted to `"chat_turn"`** — extracted `intents[]` are dropped |
| `entities` | `{type, value}[]` | from extractor |
| `context` | object (optional) | `{ price?, news?, earnings?, filings? }` |

Paper-oriented fields mentioned in comments but **not stored**: `summary`, `raw_llm_output`, `source_url`.

Persistence path: `agent/memory/memory.json` (relative to `memory-store.js`). Load on `initializeAgent()`. Save after every successful turn. Corrupted/empty file → reset to `[]`.

### Retriever (`retrieveRelevantMemories(currentIntent, limit = 3)`)

Rule-based, no embeddings:

1. A memory is relevant if `thematic_scope` matches case-insensitively, **or** any entity `value` overlaps case-insensitively.
2. Sort oldest → newest.
3. Return the last `limit` items (most recent relevant).

Gaps vs STITCH:

- Does not require intent/event compatibility.
- Does not rank by label density.
- Matching on entity value alone will mix “AAPL long-term thesis” with “AAPL price check”.
- Not called from the agent loop, so it has **zero runtime effect** today.

### Module-system landmine

`schemas.js` uses ESM `export const` / `export function`. `memory-store.js` does `require('./schemas')`. Depending on Node settings this can fail. A rewrite should use one module system.

---

## 10. Prompts (copy these)

### 10.1 Intent extraction (user message; no system instruction)

The extractor calls `generateResponse(extractionPrompt)` with **no** system prompt. The prompt includes previous-turn slots (currently always `N/A`) and asks for JSON only:

```
keys: thematic_scope (string), entities (array), intents (string[])
```

See `agent/core/intent-extractor.js` for the full template. Critical instructions to preserve:

- Resolve pronouns from previous turn.
- Always extract `STOCK_TICKER` for news / earnings / filing intents.
- Date entities as `YYYYMMDDTHHMM`.
- Year-only ranges expand to `YYYY0101T0000`–`YYYY1231T2359`.
- Multiple intents in one query are required (`"price and news"` → both).
- Return **only** valid JSON.

### 10.2 Final-answer system prompt

```
You are a financial research assistant. Your task is to strictly summarize the provided data to answer the user's query.
Do not add any information that is not present in the provided data.
Strictly adhere to the following output format:

**Summary of Information:**
- [Summary of the first piece of information]
- [Summary of the second piece of information]
...

**Answer to the user's query:**
- [Direct answer to the user's query based *only* on the summarized information]
```

### 10.3 Final-answer user prompt (when tools ran)

```
You are a financial research assistant. Your task is to summarize the provided data to answer the user's query.
Do not add any information that is not present in the provided data.
Strictly adhere to the following format:

**Summary of Information:**
- ...
**Answer to the user's query:**
- ...

**Original Query:**
"{userInput}"

**Provided Data:**
---
{augmentedPromptParts joined by \n\n---\n}
---
```

If no tools ran, the user prompt is just the raw `userInput`, still under the system prompt above. That means greetings and qualitative questions are still asked to “only use provided data” even when no data was provided — the model then improvises. A rewrite should branch: grounded mode vs conversational mode.

### 10.4 Simple price template (skips LLM)

If `intents.length === 1 && intents[0] === 'data_request' && context.price` exists, pick one at random:

- `The current stock price for {ticker} is {price}.`
- `As of the latest data, {ticker} is trading at {price}.`
- `{ticker}'s current price is {price}.`
- `The price for {ticker} is currently {price}.`

### 10.5 LLM client call shape

```js
genAI.models.generateContent({
  model: "models/gemini-flash-latest",
  contents: [{ text: prompt }],
  config: system ? { systemInstruction: system } : undefined
})
```

Text is taken from `result.candidates[0].content.parts[0].text`. Markdown fences around JSON are stripped with `/```json/g` and `/```/g`.

---

## 11. TUI (Python + Rich) — reconstruction spec

The Ink app in `UI/ui.tsx` is **legacy**. Do not recreate React, Ink, esbuild, the log pane, or `@` file suggestions. The new frontend is a full-screen Rich `Live` app in `harvey/cli/`.

The look is a hybrid of two references:

1. **Home (KILO CLI):** empty screen, large centered wordmark, centered chat input box, shortcut hints under the box, thin footer.
2. **Session (Dexter / agent traces):** submitted query as a highlighted bar, neon-green tool trees under that bar, then a cyan-bullet answer and optional data table.

### 11.1 Two screens

**Home** (no turns yet) — vertically center the cluster; pin the footer.

```
                    HARVEY          ← block ASCII, neon yellow, centered
                                    ← optional one-line green tagline

          ┌─────────────────────────────────────────────┐
          ▌ █ Ask anything... "What's AAPL trading at?" │
          ▌ Build  Google: Gemini Flash                 │
          └─────────────────────────────────────────────┘
                              tab agents   ctrl+p commands

~/.../Harvey:main                                              local
```

**Session** (after the first Enter) — header stays at the top; the transcript fills the body; the same input box sits under the latest turn (or at the bottom of the body if the transcript is long). Tool traces always render **directly under the chat input that produced them**.

```
                    HARVEY

          ┌─────────────────────────────────────────────┐
          ▌ Which semiconductor company has the best…   │
          ▌ Build  Google: Gemini Flash                 │
          └─────────────────────────────────────────────┘

          • Financials("Gross margin, operating margin, and net margin for AVGO,...")
            └ Called 4 data sources in 7.3s
            └ Called 4 data sources in 18.5s
          Let me get the actual margin percentages for a cleaner comparison.
          • AVGO wins across the board. It's not particularly close.

          ┌ Ticker │ Gross Margin │ Op Margin │ Net Margin ┐
          │ AVGO   │        67.8% │     41.8% │      36.6% │
          └────────┴──────────────┴───────────┴────────────┘

~/.../Harvey:main                                              local
```

After a turn completes, a **new empty input box** appears below the answer (same style) for the next query. Older turns stay in the scrollback above.

### 11.2 Color tokens

Use these Rich styles. The screen fill is muted charcoal (`bg`), not the terminal default.

| Token | Value | Used for |
|---|---|---|
| `bg` | `#121b1e` | full-screen background |
| `header` | `#4ecb90` | HARVEY ASCII wordmark |
| `tagline` | `#94a3a8` | product sentence |
| `muted` | `#94a3a8` | placeholder, hints, footer, labels |
| `text` | `#d1d5db` | typed input, answers, model name |
| `cursor` | reverse `text` / block `█` | caret in the input box |
| `accent` | `#4ecb90` | left bar on the input box; `Build`; selected palette row |
| `input_bg` | `#1a2428` | fill of the input box |
| `tool` | `#4ecb90` | tool name, `└` details, thoughts |
| `answer_bullet` | `#4ecb90` | `•` before the final answer |
| `answer` | `#d1d5db` | final answer sentence |
| `error` | `#c45c4a` | failed tool + `└ Error:` |
| `table` | `#4ecb90` | table border + cells |

### 11.3 Components (Rich primitives)

| Component | Implementation |
|---|---|
| Wordmark | Hardcoded ANSI-shadow ASCII `HARVEY`, `Align.center`, style `header`. Not pyfiglet. |
| Tagline | `Your AI assistant for deep financial research.` |
| Input box | `Table.grid`: col 0 is a 1-cell mint bar; col 1 is two rows on `input_bg`. Width ≈ `min(72, term_width - 8)`, centered. |
| Placeholder | Shown only when `input_text` is empty: `Ask anything... "What's AAPL trading at?"` in `muted`. |
| Status row | `Build` (`accent`, bold) + two spaces + `Google: Gemini Flash` (`text`). Later: research mode after `Build` (`long-term` / `short-term` / `risk` / `macro`). |
| Hints | Right-aligned under the box: `tab agents`, `ctrl+p commands`, `ctrl+q quit`. |
| User bar (session) | Same input-box chrome, but the first row is the committed query (white, no placeholder). |
| Tool trace | `• {ToolName}("{args truncated}")` in `tool`. Nested `└ {detail}` indented 2 spaces. Multiple details stack. Failures use `error` and `└ Error: {msg}`. |
| Thought | Plain `tool`-colored line, no bullet. Intermediate status from the graph, not a user-visible “chain of thought” dump. |
| Answer | `•` in `answer_bullet` + rest of line in `answer`. Bold the first sentence if the model marks it. |
| Table | `rich.table.Table` with `box.SIMPLE`, `border_style=table`. Emitted only when the graph provides structured rows (comparison queries). |
| Footer | 1 row. Left: `{abbrev_home(cwd)}:{git_branch}` in `muted`. Right: `local` in `muted`. |

Do **not** recreate: Agent Logs pane, green `Processing...` spinner as the primary busy state (the live tool tree is the busy state), `@` file picker, markdown-terminal dump of the whole reply.

### 11.4 Interaction

| Key | Action |
|---|---|
| printable | insert at cursor |
| Backspace | delete |
| Enter | submit if non-empty and not already running; `/quit` `/exit` `/q` leave immediately |
| Ctrl+C / Ctrl+D / Ctrl+Q | quit |
| Ctrl+P | command palette: `/summary`, `/export`, `/clear-mem`, `/help`, `/quit` |
| Tab | cycle research mode: long-term → short-term → risk → macro (product todo; show on the status row) |
| Up/Down | history of submitted queries |

Mouse-wheel and incomplete ANSI sequences must be parsed as whole CSI/SS3 events and **never** inserted as text (the `OABAB` scroll bug).

Input is disabled while a turn is running (box still shows the committed query). Quit keys still work while a turn is running.

The TUI does **not** have to stream LLM tokens in v1. It **must** stream **tool events** as they happen (start, detail, error, done) so the tree grows under the input box instead of appearing all at once.

### 11.5 Graph → TUI event protocol

The LangGraph run must yield (or callback) these events. The TUI never calls tools itself.

```python
class UiEvent(TypedDict):
    type: Literal[
        "tool_start",    # name, args
        "tool_detail",   # name, detail  e.g. "Called 4 data sources in 7.3s"
        "tool_done",     # name, duration_ms, error?
        "thought",       # text
        "answer",        # text
        "table",         # headers: list[str], rows: list[list[str]]
        "error",         # text
    ]
```

Map Node traces to UI:

- `run_tools` → `tool_start` / `tool_detail` / `tool_done` (one tree per tool; parallel tools are sibling `•` lines)
- optional short status from `generate_answer` → `thought`
- final string → `answer`
- structured comparison payload → `table`

Preserve the old contract semantically: **every tool, including failures, is visible**.

### 11.6 Layout engine

`rich.live.Live(..., screen=True, refresh_per_second=24)` + `rich.layout.Layout`:

```
root
  ├── header     # wordmark + tagline; size ~7 on home, can shrink on small terms
  ├── body       # home: Align.center(input cluster); session: transcript + input
  └── footer     # size 1
```

Home: `body` vertically centers the input cluster (box + hints). Session: `body` is a `Group` of completed turns (user bar + traces + thought + answer + table) then the live input cluster. If the group exceeds `body` height, crop from the **top** (keep the latest turn and the input visible).

Read keys with `tty.setcbreak` + `select` on stdin (Rich is render-only; do not pull in Textual unless the spec changes).

### 11.7 What the old Ink UI did that we still need

- Ctrl+C exits.
- Input disabled until the backend is ready.
- Header wordmark + one-line blurb.
- Every tool call rendered with name, args, duration; errors distinct.
- Request/response agent (no token streaming required).

Dropped on purpose: log pane, `@` files, Ink spinner as the main busy UI, `Agent:` prefix, cyan `> prompt` line (replaced by the centered box).

---

## 12. Worked examples from stored memory

From `UI/dist/memory.json`:

**Price**

- User: `Whats the stock price of AAPL today ?`
- Scope: `stock price inquiry`
- Entities: `STOCK_TICKER:AAPL`, plus a same-day `DATE_FROM`/`DATE_TO`
- Context: `{ price: { ticker: "AAPL", price: 257.46 } }`
- Response: templated sentence, not the two-section markdown format.

**News**

- User: `What is the latest news on MSFT ?`
- Scope: `latest news`
- Context stores the full Alpha Vantage feed (sentiment, topics, URLs).
- Response is a multi-section institutional-flow summary. Note: this is **richer than the system prompt allows** — the model is summarizing article text, which is intended, but it also generalizes beyond the bullet list.

`event_type` on both is `"chat_turn"`, confirming intents are not persisted.

---

## 13. Known defects to fix in the rewrite

1. **Retriever never used** — STITCH memory is write-only in production.
2. **Previous turn not passed** — coreference is dead code.
3. **`intents[]` not persisted** — retrieval cannot filter by event type.
4. **Entity consumption** — one ticker cannot serve two tools unless duplicated.
5. **News field mapping** — `source.name` / `description` vs Alpha Vantage `source` / `summary`.
6. **Earnings null safety** — missing GAAP EPS crashes the cycle.
7. **SEC User-Agent** missing.
8. **Frozen “today”** in the extractor prompt (2026-02-21).
9. **CJS/ESM schema export** mismatch.
10. **Stale `index.d.ts`**.
11. **`openai` unused**.
12. **`/summary` does not read memory** — it just sends a generic sentence through the same tool loop.
13. **No streaming, no retries, no structured-output guarantee** (JSON is regex-cleaned).
14. **Alpha Vantage keys read at import time**.
15. **Grounded system prompt applied to tool-less chat.**

---

## 14. LangGraph / LangChain recreation blueprint

This is the recommended target architecture. Preserve Harvey’s behavior first, then close the STITCH gaps.

### 14.1 Graph state

```python
class Entity(TypedDict):
    type: str
    value: str

class ToolTrace(TypedDict):
    tool_name: str
    tool_input: str
    duration_ms: int
    output: str | None
    error: str | None

class HarveyState(TypedDict):
    user_input: str
    previous_turn: dict          # {user_input, llm_response, thematic_scope, intents, entities}
    thematic_scope: str
    intents: list[str]
    entities: list[Entity]
    retrieved_memories: list[dict]
    tool_results: dict           # {price?, news?, earnings?, filings?}
    prompt_parts: list[str]
    all_tool_calls: list[ToolTrace]
    response: str
    command: str | None
```

Use a **checkpointer** (Sqlite/Postgres) for conversation state and a **LangGraph Store** (or custom JSON/SQLite table) for STITCH memory snippets. Do not rely on the LLM context window as the only memory.

### 14.2 Nodes

| Node | Responsibility | LangChain primitive |
|---|---|---|
| `parse_command` | Detect `/summary`, `/export`, `/clear-mem` | plain function |
| `extract_intent` | Structured output → scope, intents, entities | `with_structured_output` (Pydantic) |
| `retrieve_memory` | STITCH filter + optional embedding tie-break | custom retriever + Store |
| `resolve_coref` | Rewrite query using retrieved + previous turn | small LLM call, optional |
| `route_tools` | Map intents → tool jobs, consume entities | plain function |
| `run_tools` | Parallel tool execution | `Send` API or `asyncio.gather` |
| `format_tool_results` | Build prompt_parts + traces + context | plain function |
| `generate_answer` | Template **or** grounded LLM | `ChatPromptTemplate` + model |
| `persist_memory` | Write snippet with full `ι_t` | Store / SQLite |

### 14.3 Graph topology

```
START
  → parse_command
      ├─ (slash command) → command_handler → END
      └─ (chat) → extract_intent
                    → retrieve_memory
                    → resolve_coref          # currently missing; add it
                    → route_tools
                    → run_tools              # fan-out if N>0
                    → format_tool_results
                    → generate_answer
                    → persist_memory
                    → END
```

Conditional edges:

- After `route_tools`: if no tool jobs, skip `run_tools`.
- After `format_tool_results`: if simple single `data_request` with a price, skip the LLM and use a template node.

### 14.4 Tools as LangChain tools

```python
@tool
def fetch_stock_price(ticker: str) -> float | None: ...

@tool
def fetch_news(ticker: str, time_from: str | None = None, time_to: str | None = None, limit: int = 5) -> list[dict] | None: ...

@tool
def fetch_earnings_eps(ticker: str) -> dict | None: ...   # wraps getCik + companyfacts + EPS extract

@tool
def fetch_recent_filings(ticker: str) -> list[str] | None: ...
```

Do **not** start with an LLM tool-calling agent (`bind_tools` + ReAct). Harvey’s routing is schema-driven and cheaper/more predictable. You can later add a fallback ReAct node for `financial_query` that still cannot invent numbers.

### 14.5 Memory: implement real STITCH

Store each snippet as:

```python
class MemorySnippet(BaseModel):
    id: int
    timestamp: datetime
    user_input: str
    rewritten_input: str | None
    llm_response: str
    thematic_scope: str          # σ
    event_types: list[str]       # ε  (persist intents here)
    entity_types: list[str]      # κ  (types only, for density ranking)
    entities: list[Entity]       # typed values
    context: dict                # raw tool payloads
    source_urls: list[str]
    canonical_summary: str       # c_t
```

Retrieval (`F_q` from the current intent):

1. Score label density:
   - +1 if scope matches (or is a known alias of the active research goal)
   - +1 per overlapping event type
   - +1 per overlapping entity type
2. Optionally require event-type compatibility unless the user explicitly asks to mix intents.
3. Tie-break with embeddings (`langchain.embeddings` + vector store) **only among** structurally compatible hits.
4. Return last/top `k=3` in chronological order for the prompt.

This is the paper’s “label density then semantic similarity” rule, specialized to finance.

### 14.6 Package layout (in-repo, not a separate `harvey-lg/`)

```
Harvey/
  pyproject.toml
  .env
  harvey/
    __main__.py             # python -m harvey
    cli/
      app.py                # Live loop, key handling, backend wiring
      theme.py              # color tokens from §11.2
      render.py             # home + session Layout
      state.py              # UiState / Turn / ToolTrace
    graph/
      graph.py              # StateGraph compile
      state.py              # HarveyState
      events.py             # UiEvent stream from node updates
      nodes/
        extract_intent.py
        retrieve.py
        tools_router.py
        generate.py
        persist.py
    tools/                  # Alpha Vantage + SEC
      finance.py
      news.py
      sec.py
    memory/
      schema.py
      store.py
      retriever.py
    prompts/
      extract.py
      answer.py
```

The TUI invokes `graph.ainvoke(...)` (via an emit callback that yields `UiEvent`s).

### 14.7 Models

Current: Gemini Flash via `@google/genai`.

LangChain equivalent: `langchain-google-genai` `ChatGoogleGenerativeAI(model="gemini-flash-latest")` or pin a dated Flash model.

Use **structured output** for intent extraction (JSON schema / Pydantic). Do not parse fenced JSON by regex.

### 14.8 Evaluation hooks (from `main.todo`)

When the graph exists, log per turn:

- extracted `ι_t`
- tools queued vs tools skipped (missing entity)
- retrieved memory IDs and density scores
- whether the answer stayed inside provided data

That is enough to compare against one-shot ChatGPT/Perplexity and to show intent separation.

---

## 15. Roadmap snapshot (`main.todo`)

Already done in the Node agent:

- Goal/intent parser with multi-intent arrays
- Concurrent tool calls + error traces in the UI
- Alpha Vantage price + news (with date windows)
- SEC company facts + submission metadata
- Intent-tagged JSON memory (write path)
- Ink UI with tool-call and error indicators (legacy; replaced by Rich TUI)
- Grounded summarizer prompt + price templates

Not done (carry into the LangGraph port):

- Explicit research-mode gate (long-term / short-term / risk / macro)
- FRED macro series
- Shared normalized data model (timestamps + entity labels on every fact)
- Source URL required on every memory
- Intent-compatible retrieval + stitching + belief timeline
- Contradiction / assumption-break detection
- `/help`, memory inspect-by-intent, “what changed and why”
- Evaluation vs one-shot chat tools
- Wire Rich TUI to the live LangGraph stream (demo backend first)

---

## 16. How to run

### Target (Python TUI)

```bash
# 1. Root .env with GEMINI_API_KEY and ALPHA_VANTAGE_API_KEY

python3 -m venv .venv
source .venv/bin/activate
pip install -e .

python -m harvey           # live LangGraph agent (needs GEMINI_API_KEY + ALPHA_VANTAGE_API_KEY)
python -m harvey --demo    # canned traces, no API keys
python -m harvey --dump home
python -m harvey --dump session
```

---

## 17. Design invariants to keep

1. **Numbers come from tools, not the model.** The summarizer may rephrase, not invent prices, EPS, or filing dates.
2. **Intent is extracted before any fetch.** No speculative API calls.
3. **Multiple intents in one sentence run in parallel.**
4. **Memory is intent-addressable**, not a flat chat log and not embedding-only RAG.
5. **The UI shows every tool, including failures.** Tool trees render under the chat input that launched them.
6. **Finance domain only** for tools. Qualitative chat is allowed but should not pretend to have live data.

If a future LangGraph design violates (1), (2), or (4), it is no longer Harvey.
)

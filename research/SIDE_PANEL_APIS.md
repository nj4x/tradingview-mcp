# TradingView Side-Panel REST API Research

> Produced by multi-agent research sweep (2026-06-28). Key endpoints probed live (HTTP 200) against `NASDAQ:AMZN` unless noted. Column catalogs are sourced from community libraries unless marked ✓ probed. All endpoints are internal/undocumented — no official TradingView REST docs exist.

## Executive Summary

Eight of the ten side-panel areas are feasible to wire via REST. Two are already implemented (`news`, `options_search`). Five new categories can be added using the existing `_rest.js` infrastructure with minimal code. One area (`seasonals`) has no discoverable public endpoint — likely client-computed from OHLCV history. Technicals is partially covered today via CDP chart studies; a cleaner REST path also exists.

## Feasibility Matrix

| Area | Status | Endpoint Type | Auth Required | Priority |
|------|--------|--------------|---------------|----------|
| **News** | ✅ Already wired | `news-headlines.tradingview.com` | No (partial); session for full body | — |
| **Options** | ✅ Already wired (discovery) | `symbol-search.tradingview.com` + renderer fallback | No (tier-1); session (tier-2) | — |
| **Financials** | 🆕 New | Scanner: `scanner.tradingview.com/symbol` GET | None | High |
| **Forecast** | 🆕 New | Scanner: same endpoint as Financials | None | High |
| **ETFs** | 🆕 New | Scanner: `scanner.tradingview.com/america/scan` POST | None | High |
| **Bonds** | 🆕 New | Scanner: `scanner.tradingview.com/bond/scan` POST | None | High |
| **Technicals** | 🆕 New (REST) | Scanner: `scanner.tradingview.com/<market>/scan` POST | None | Medium |
| **Documents** | 🆕 New | `news-mediator.tradingview.com/public/doc-screener/v1/documents` | No (list); session (files) | Medium |
| **Community** | 🆕 New (read-only) | `tradingview.com/api/v1/ideas/`, `v2/minds/`, `v1/scripts/` | None (read) | Medium |
| **Seasonals** | ❌ No public API | Unknown / likely client-computed | N/A | — |

---

## Already Implemented

### News (`news_get_headlines`, `news_get_story`)

- **Headlines:** `GET https://news-headlines.tradingview.com/v2/view/headlines/symbol?client=overview&lang=en&symbol=NASDAQ%3AAMZN`
- **Story:** `GET https://news-headlines.tradingview.com/v2/story?client=overview&lang=en&id=<id>`
- **Auth:** Both return 200 unauthenticated; full article body is gated by `permission: "headline"` for some providers (e.g. Reuters). `restFromRenderer` carries the session cookie via `credentials: 'include'` to unlock full content.
- **Implementation:** `src/core/news.js`, `src/tools/news.js` — REST-only, no CDP fallback.

**Proposed bug fix (pending AST-shape confirmation — see Open Questions #6):** `getStory` at `src/core/news.js:72` tests `data.content || data.body || data.story_body`. Live unauthenticated probes show the actual top-level field is `data.astDescription` (a ProseMirror AST). The existing `.content`-recursive `flat()` walker at `src/core/news.js:60` recurses on `.content` arrays; it will handle nested AST nodes correctly only if they have `.content` children — but ProseMirror leaf nodes (`{type:'text', text:'…'}`) have no `.content`, so the walker may also need a `node.text` branch. **Proposed fix:** add `data.astDescription ||` before `data.content`; verify the AST shape against a live logged-in session response before finalizing.

### Options (`options_search`)

- **Tier-1 (public):** `GET https://symbol-search.tradingview.com/symbol_search/v3/?search_type=option&text=AMZN` via `restFromNode`. Blocked by 403 for non-browser User-Agents; the repo passes `Origin`/`Referer` headers.
- **Tier-2 (fallback):** renderer `window.TradingViewApi.searchSymbols({text, type:'option'})`.
- **Scope:** contract discovery only — no full chain, no greeks, no IV surface.
- **Dedicated scanner:** `scanner.tradingview.com/options/scan` returns HTTP 400 unauthenticated (endpoint exists but requires auth and/or a specific body format — not confirmed).

---

## New Endpoints to Wire

### Financials

**Endpoint (preferred):** `GET https://scanner.tradingview.com/symbol?symbol=NASDAQ:AMZN&fields=<csv>`

```
fields=total_revenue,gross_profit,oper_income,net_income,
       earnings_per_share_basic_ttm,price_earnings_ttm,price_book,
       price_cash_flow,total_assets,total_liabilities,total_equity,
       ebitda,ebit
```

**Auth:** None. Works from Node via `restFromNode`.

**Response shape:**
```json
{
  "net_income": 77670000000,
  "total_revenue": 716924000000,
  "gross_profit": 360510000000,
  "total_assets": 916630000000,
  "price_earnings_ttm": 27.808,
  "earnings_per_share_basic_ttm": 8.4877
}
```

**Alternative (POST scanner):** `POST https://scanner.tradingview.com/america/scan` with `{"symbols":{"tickers":["NASDAQ:AMZN"]},"columns":[...]}`. Same data, positional array response — requires zipping column names to values. GET form is cleaner for single-symbol lookups.

**Columns — ✓ probed (returned a value for NASDAQ:AMZN):**
- Income: `total_revenue`, `gross_profit`, `net_income`
- Balance sheet: `total_assets`
- Ratios: `price_earnings_ttm`

**Columns — from community libraries (unverified live):**
- Income: `oper_income`, `ebitda`, `ebit`
- Balance sheet: `total_liabilities`, `total_equity`
- Ratios: `price_earnings_fwd`, `price_cash_flow`, `price_book`
- Quarterly history: `total_revenue_fq_h` (array of last ~32 quarters)

**Implementation:**
- New `src/core/financials.js` using `restFromNode`
- `fetchFinancials({ symbol, fields, _deps })` — fields default to a curated income/balance/ratio set
- Tool: `financials_get` routed `headless`; returns normalized object (not positional array)
- DI via `_deps: { fetch }` for offline tests

---

### Forecast (Analyst Consensus)

**Endpoint:** Same `scanner.tradingview.com/symbol` GET as Financials — different field set.

```
fields=price_target_average,price_target_high,price_target_low,price_target_median,
       price_target_estimates_num,recommendation_mark,recommendation_buy,
       recommendation_hold,recommendation_sell,recommendation_total,
       earnings_per_share_forecast_next_fq,revenue_forecast_next_fq,
       earnings_release_next_date,earnings_release_date
```

**Response shape:**
```json
{
  "price_target_average": 316.56,
  "price_target_high": 370,
  "price_target_low": 230,
  "price_target_median": 319.5,
  "price_target_estimates_num": 64,
  "recommendation_mark": 1.11,
  "recommendation_buy": 59,
  "recommendation_hold": 2,
  "recommendation_sell": 0,
  "recommendation_total": 73,
  "earnings_per_share_forecast_next_fq": 1.8143,
  "revenue_forecast_next_fq": 196095996342,
  "earnings_release_next_date": 1785412800,
  "earnings_release_date": 1777495200
}
```

**Scale:** `recommendation_mark` is a 1–5 weighted consensus (1=Strong Buy, 3=Hold, 5=Strong Sell) — **inferred** from the single probed sample (1.11 with 59 buy / 2 hold / 0 sell analysts); the sell end of the scale is not independently verified. Render thresholds (community-sourced): ≤1.5=Strong Buy, ≤2.5=Buy, ≤3.5=Hold, ≤4.5=Sell, >4.5=Strong Sell.

> **Note:** This 1–5 analyst-consensus field is entirely distinct from `Recommend.All` (Technicals), which uses a ±1 scale. Do not conflate them.

**Implementation:** Can share the same `src/core/financials.js` module as Financials (same endpoint, different default fields), or be a thin separate export. Tool: `forecast_get` routed `headless`.

---

### ETFs

**Endpoint:** `POST https://scanner.tradingview.com/america/scan`

**Request body (screener mode):**
```json
{
  "filter": [{"left": "type", "operation": "equal", "right": "fund"}],
  "columns": ["name", "description", "close", "change", "aum",
               "expense_ratio", "asset_class.tr", "focus.tr",
               "nav_total_return.3Y", "fund_flows.1M",
               "fundamental_currency_code"],
  "sort": {"sortBy": "aum", "sortOrder": "desc"},
  "range": [0, 50]
}
```

**Request body (single ticker):**
```json
{
  "symbols": {"tickers": ["AMEX:VOO"]},
  "columns": ["name", "description", "close", "change", "aum",
               "expense_ratio", "asset_class.tr", "focus.tr",
               "nav_total_return.3Y", "fund_flows.1M"]
}
```

**Auth:** None. `restFromNode` with `Origin: https://www.tradingview.com` header. Confirmed HTTP 200 with 6,377 ETF results.

**Sample data (VOO):** AUM ≈ 956.7B, expense_ratio 0.03, asset_class "Equity", focus "Large cap".

**Column notes:**
- `.tr` suffix = translated/localized string value
- `nav_total_return.3Y` = 3-year NAV total return
- `fund_flows.1M` = 1-month fund flow in USD
- Response `d[]` is positional — must zip against requested `columns` list

**Implementation:**
- New `src/core/etf.js` using `restFromNode`
- `searchEtfs({ query, fields, limit, _deps })` — search by name/ticker
- `getEtf({ symbol, _deps })` — single ETF detail lookup
- Tool: `etf_search` / `etf_get` routed `headless`

---

### Bonds

**Endpoint:** `POST https://scanner.tradingview.com/bond/scan`

**Request body:**
```json
{
  "columns": ["name", "description", "coupon", "bond_yield_to_maturity",
               "maturity_date", "close", "change"],
  "sort": {"sortBy": "bond_yield_to_maturity", "sortOrder": "desc"},
  "range": [0, 50]
}
```

**Auth:** None. `restFromNode`. Confirmed HTTP 200 with 256,196 instruments.

**Column notes:**
- `maturity_date` returns as YYYYMMDD integer (e.g. `20290430`) — parse same way as `parseExpiry` in `src/core/options.js`
- `bond_yield_to_maturity` = YTM as decimal (e.g. `0.045` = 4.5%)
- `coupon` = coupon rate as decimal

**Implementation:**
- New `src/core/bonds.js` using `restFromNode`
- `searchBonds({ query, maturity_after, maturity_before, min_yield, max_yield, limit, _deps })`
- Tool: `bond_search` routed `headless`

---

### Technicals (Technical Analysis Ratings)

**Endpoint:** `POST https://scanner.tradingview.com/<screener>/scan`

Screener must match the symbol's exchange: `america` (US stocks), `crypto` (crypto), `forex`, `futures`, `india`, `uk`, etc.

**Request body:**
```json
{
  "symbols": {"tickers": ["NASDAQ:AMZN"]},
  "columns": ["Recommend.All", "Recommend.MA", "Recommend.Other"]
}
```

**Auth:** None. Confirmed working with just `User-Agent` header — use `restFromNode`.

**Response:**
```json
{
  "totalCount": 1,
  "data": [{"s": "NASDAQ:AMZN", "d": [-0.354, -0.8, 0.09]}]
}
```

Values in `-1..+1`: −1=strong sell, +1=strong buy. TradingView thresholds: `|v| ≤ 0.1` = neutral, `0.1–0.5` = buy/sell, `>0.5` = strong buy/sell.

**Interval suffixes:** append `|60` (1h), `|240` (4h), `|1D` (daily), `|1W` (weekly), `|1M` (monthly) to any column. Default (no suffix) = daily. Example: `Recommend.All|1W`.

**Columns — ✓ probed:** `Recommend.All`, `Recommend.MA`, `Recommend.Other` (all returned float values in ±1 range)

**Columns — from `python-tradingview-ta` docs (unverified live):** `RSI`, `RSI[1]`, `MACD.macd`, `MACD.signal`, `BB.upper`, `BB.lower`, `EMA5`, `EMA10`, `EMA20`, `EMA50`, `EMA100`, `EMA200`, `Perf.W`, `Perf.1M`, `Perf.3M`, `Perf.YTD`, `Perf.Y`.

**Screener detection:** derive from the symbol exchange prefix. Incorrect screener → silent empty result (no error), so detection must be reliable.

| Exchange prefix(es) | Screener slug |
|---------------------|--------------|
| `NASDAQ`, `NYSE`, `AMEX`, `BATS`, `OTC` | `america` |
| `TSX`, `TSXV` | `canada` |
| `LSE`, `AIM` | `uk` |
| `XETR`, `FSX` | `germany` |
| `BSE`, `NSE` | `india` |
| `BINANCE`, `COINBASE`, `KRAKEN`, `BITFINEX` | `crypto` |
| `FX_IDC`, `OANDA`, `FXCM` | `forex` |
| `CME`, `CBOT`, `NYMEX`, `COMEX`, `EUREX` | `futures` |
| Unknown | `america` fallback, surface `screener_guessed: true` in response |

Source: derived from `python-tradingview-ta` exchange mapping (community-sourced, not verified for exhaustiveness). For unknown prefixes, fall back to `america` AND include a `screener_guessed: true` flag in the response so callers can detect empty-vs-wrong-screener scenarios.

**Existing overlap:** `data_get_study_values` already reads live indicator values from the visible chart. The scanner endpoint is complementary — it works headless on any symbol without chart manipulation, and returns TradingView's pre-computed summary rating.

**Implementation:**
- New `src/core/technicals.js` using `restFromNode`
- `fetchTechnicals({ symbol, columns, interval, _deps })` — auto-detects screener from symbol
- Tool: `technicals_get` routed `headless`

---

### Documents (SEC Filings, Transcripts, Earnings Materials)

**List endpoint (public):**
```
GET https://news-mediator.tradingview.com/public/doc-screener/v1/documents
    ?client=web&filter=symbol:NASDAQ:AMZN&filter=lang:en
```

Optional filters: `&filter=id:quarterly_report,annual_report` or `&filter=event:earning`.

**Auth:** None for listing. Confirmed HTTP 200.

**Response shape (abridged):**
```json
{
  "total": 201,
  "items": [{
    "id": "urn:report:quartr.com:3273951",
    "title": "Q1 2026",
    "category": {"id": "quarterly_report", "title": "Quarterly report"},
    "fiscal_period": "Q1", "fiscal_year": 2026,
    "event": "earning",
    "reported": 1777498200,
    "provider": {"id": "quartr", "name": "Quartr"},
    "form": {"id": "form_10q", "title": "10-Q"},
    "views": [
      {"id": "urn:report:quartr.com:3273951-abc123", "type": "pdf"},
      {"id": "urn:summary_document_report:quartr.com:1965082", "type": "summary"}
    ]
  }]
}
```

**Category IDs:** `quarterly_report`, `annual_report`, `earnings_release`, `call_transcript`, `event_transcript`, `slides`, `press_release`

**File retrieval (auth-gated):**
```
GET https://news-mediator.tradingview.com/doc-screener/v1/files/{viewId}
```
Requires session cookie + `"documents"` feature entitlement. Use `restFromRenderer`. Recommend soft-failure (return list-only result with `{ file_available: false }`) if 403.

**Data source:** All documents backed by Quartr (third-party vendor). `reported` field is Unix **seconds** (not milliseconds — different from the rest of TradingView's API surface).

**Implementation:**
- New `src/core/documents.js`
- `listDocuments({ symbol, categories, lang, limit, _deps })` — `restFromNode`
- `getDocumentFile({ viewId, _deps })` — `restFromRenderer`, soft-fail on 403
- Tools: `documents_list`, `documents_get_file` routed `headless`

---

### Community (Ideas, Scripts, Minds)

All three are read-only, public, no auth required.

#### Ideas

```
GET https://www.tradingview.com/api/v1/ideas/?symbol=NASDAQ%3AAMZN&page=1
```

**Response:** `{ count, page_size, page_count, next, results: [{ id, name, description, created_at, chart_url, is_hot, comments_count, views_count, likes_count, user, ... }] }`

Pagination: `?page=N` (offset-based). Up to 1,000 results total, 20 per page.

#### Minds (Discussion Posts)

```
GET https://www.tradingview.com/api/v2/minds/?symbol=NASDAQ%3AAMZN&limit=20
```

**Response:** `{ results: [{ uid, text_ast, author, created, total_comments, ... }], next, prev }`

Pagination: cursor-based (`?c=<opaque>` from `next` field). `text_ast` is a ProseMirror AST — must walk `.children` recursively to extract plain text.

#### Scripts (Community Pine Scripts)

```
GET https://www.tradingview.com/api/v1/scripts/?symbol=NASDAQ%3AAMZN&q=<keyword>&page=1
GET https://www.tradingview.com/pubscripts-suggest-json/?search=<keyword>
```

Script source retrieval: `GET https://pine-facade.tradingview.com/pine-facade/get/PUB;<hash>/<version>` — no auth.

**Implementation:**
- New `src/core/community.js`
- `getIdeas({ symbol, page, sort, _deps })`, `getMinds({ symbol, limit, cursor, _deps })`, `getScripts({ symbol, query, page, _deps })`
- All via `restFromNode` (public endpoints on `www.tradingview.com`)
- Tools: `community_get_ideas`, `community_get_minds`, `community_get_scripts` routed `headless`
- Mutations (post/like/delete) require CSRF tokens — exclude from MCP scope

---

## Not Feasible

### Seasonals

No public REST endpoint found after dedicated research. The Seasonality panel is almost certainly computed client-side within the TradingView renderer from historical OHLCV data — no `seasonality.tradingview.com` or equivalent exists in community documentation or network captures.

**Only viable paths:**
1. CDP Network interception: open the Seasonality panel while `TV_MCP_NETWORK=1` is set, capture the outbound XHR/fetch, then replicate the endpoint.
2. Compute in Node: fetch 10+ years of monthly OHLCV via `chart_fetch_ohlcv`, aggregate average monthly returns — approximates TradingView's display but not sourced from it.

Neither path is clean. Recommend deferring until the endpoint is confirmed via CDP network capture.

---

## Implementation Patterns

All new tools follow the existing REST-first doctrine from `src/core/_rest.js`:

```js
// Public endpoint (no auth) — use restFromNode
// Mirror: src/core/options.js:21-24 for the correct DI pattern
import { restFromNode, assertRestEnabled } from './_rest.js';
import { makeResolver } from './_resolve.js';
import { TvError } from './TvError.js';

// fetch is NOT pool-governed — it goes in the extras map, NOT the names array.
// makeResolver(poolNames, extras): poolNames fall back to SINGLETON ({evaluate,evaluateAsync});
// extras fall back to the provided default. Putting 'fetch' in poolNames would resolve
// to undefined under the singleton (TV_MCP_STRICT_DI=1 would throw).
const _resolve = makeResolver(['evaluateAsync'], { fetch: globalThis.fetch });
//                             ^ only if module also needs evaluateAsync; drop if not

export async function fetchTechnicals({ symbol, columns, interval, _deps } = {}) {
  const { fetch } = _resolve(_deps);
  assertRestEnabled('technicals_get');
  const screener = detectScreener(symbol);   // 'america', 'crypto', etc.
  const cols = columns.map(c => interval ? `${c}|${interval}` : c);
  const body = JSON.stringify({ symbols: { tickers: [symbol] }, columns: cols });
  const data = await restFromNode(fetch,
    `https://scanner.tradingview.com/${screener}/scan`,
    { method: 'POST', body, headers: { 'Content-Type': 'application/json',
      'Origin': 'https://www.tradingview.com', 'Referer': 'https://www.tradingview.com/' } });
  const row = data.data?.[0];
  // Use REST_HTTP (or JS_EVAL via TvError.from) — SYMBOL_NOT_FOUND is not a defined code.
  // Scanner returns 200 with empty data[], not a 4xx, for unknown symbols.
  if (!row) throw new TvError('REST_HTTP', `No scanner data for ${symbol}`, { retryable: false });
  // Defensive zip: assert column count matches before returning
  if (row.d.length !== cols.length)
    throw new TvError('JS_EVAL', `Scanner column mismatch: expected ${cols.length}, got ${row.d.length}`);
  return Object.fromEntries(cols.map((c, i) => [c, row.d[i]]));
}
```

```js
// Authenticated endpoint — use restFromRenderer
// restFromRenderer runs the fetch inside the renderer via evaluate(); buildFetchExpr()
// internally passes the URL through safeString(), so URL-encoding dynamic params is
// sufficient — do NOT separately call safeString() on the URL string.
import { restFromRenderer, assertRestEnabled } from './_rest.js';
import { TvError } from './TvError.js';

export async function getDocumentFile({ viewId, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  assertRestEnabled('documents_get_file');
  try {
    return await restFromRenderer(evaluateAsync,
      `https://news-mediator.tradingview.com/doc-screener/v1/files/${encodeURIComponent(viewId)}`);
  } catch (err) {
    // 403 = session missing or no "documents" entitlement — soft-fail
    if (err.code === 'REST_HTTP' && err.status === 403)
      return { success: true, file_available: false, error: 'File access requires TradingView documents entitlement' };
    // 401 = session expired — surface distinctly so callers can prompt re-login
    if (err.code === 'REST_HTTP' && err.status === 401)
      return { success: true, file_available: false, error: 'TradingView session expired — re-open TradingView' };
    throw err;
  }
}
```

**Rollback contract:** All eight new tools are REST-only with no CDP fallback. Setting `TV_MCP_REST=0` will cause them to throw `TvError('REST_DISABLED')`, identical to the existing `news_get_headlines` / `pine_list_scripts` contract. Add each new tool name to `assertRestEnabled()` calls accordingly.

Tool registration follows `src/tools/news.js` pattern: thin Zod wrapper, `withTab({ route: 'headless' })`, `jsonResult()`.

---

## Bugs Found

| Location | Bug | Fix |
|----------|-----|-----|
| `src/core/news.js:72` | `getStory` tests `data.content \|\| data.body \|\| data.story_body` but live unauthenticated probes show the actual top-level field is `data.astDescription` (ProseMirror AST). Story body is always `undefined` because `data.content` is absent. | **Proposed fix (pending AST-shape confirmation):** add `data.astDescription \|\|` before `data.content`. The `.content`-recursive `flat()` walker at `news.js:60` handles nested nodes correctly only if they have `.content` children — ProseMirror leaf nodes (`{type:'text', text:'…'}`) do not, so the walker may also need a `node.text` branch. Verify against a live logged-in session response before finalizing. See Open Question #6. |

---

## Caveats and Risks

1. **All endpoints are undocumented internal APIs.** TradingView does not publish a REST API. Any endpoint can change without notice. The scanner (`scanner.tradingview.com`) is the highest-stability surface because the official chart depends on it directly.

2. **Terms of Service.** Programmatic access to these endpoints is outside TradingView's official API offering. The project already accepts this tradeoff (per `RESEARCH.md` Limitations section) — these new tools carry the same caveat.

3. **Unauthenticated data may be delayed.** Intraday `close`/`change` fields from the scanner are likely 15-min delayed without a session cookie (not independently probed — inferred from TradingView's standard delayed-data policy). Fundamental fields (`total_revenue`, `price_earnings_ttm`, etc.) are quarterly or daily snapshots and are not sensitive to delay. For real-time intraday values, use `restFromRenderer` (carries session cookie) rather than `restFromNode`.

4. **Screener selection for Technicals.** The scanner market must match the symbol's exchange. Incorrect screener → empty results, not an error. Auto-detection from the exchange prefix (`NASDAQ:` → `america`) covers most cases but needs a fallback for unknown exchanges.

5. **Positional array responses.** Scanner POST responses return `d: [val1, val2, ...]` indexed by the requested `columns` array. The core function must zip these before returning. A column order mismatch silently returns wrong data.

6. **`maturity_date` is YYYYMMDD integer** in bond scanner responses. Parse the same way as `parseExpiry` in `src/core/options.js:50`. Note: scanner forecast date fields (`earnings_release_next_date`) are Unix **seconds**, not milliseconds — different from `chart_fetch_ohlcv` bar times which are milliseconds when `> 1e12`.

7. **Documents file retrieval is gated.** The `doc-screener/v1/files/{id}` endpoint requires both a session cookie and TradingView's `"documents"` feature entitlement. Soft-failure is mandatory — not all accounts have this.

8. **Community `text_ast` field.** Minds posts return a ProseMirror AST, not plain text. The tool should either return the raw AST or include a lightweight walker that extracts plain text — the choice affects context cost.

9. **Rate limiting.** `scanner.tradingview.com` and `www.tradingview.com/api/*` will rate-limit aggressive polling. `restFromNode` sends no session cookie, so requests are IP-bucketed (stricter limits than session-authenticated calls). The `headless` pool could fan out concurrent scanner calls and trip limits. `REST_HTTP` 429 is already classified `retryable: true` in `src/core/_rest.js:78` — callers should back off on 429 and recommend client-side caching for high-frequency tools.

10. **`restFromRenderer` session expiry.** `getDocumentFile` and full news bodies depend on a live logged-in TradingView session. An expired or rotated session yields 401/403. The code examples above distinguish 401 (expired) from 403 (no entitlement); callers should surface the "re-open TradingView" message rather than treating both as a silent empty result.

---

## Open Questions

1. **`options/scan` auth shape.** The dedicated options scanner (`scanner.tradingview.com/options/scan`) returns HTTP 400 unauthenticated. What body format and auth headers does it require? CDP network capture during Options panel interaction would reveal this. If unlocked, it would provide greeks and full chain data.

2. **Seasonals endpoint.** Does TradingView have a backend seasonality endpoint, or is it always computed client-side? Network capture while the Seasonality panel is open would confirm.

3. **Technicals screener mapping.** What is the canonical mapping from TradingView exchange prefixes to scanner market slugs? The community library `python-tradingview-ta` maintains this — worth importing or mirroring.

4. **Financials historical statements.** `total_revenue_fq_h` returns an array of ~32 quarterly values. What field names expose quarterly EPS, net income, gross profit history? Full historical income/balance/cash-flow statements may require different column names not yet catalogued.

5. **Documents `summary` view type.** `views[].type === "summary"` appears to be an AI-generated abstract (likely from Quartr's AI layer). Is this retrievable without the `documents` entitlement? Worth testing separately from PDF retrieval.

6. **`news_get_story` `astDescription` mapping.** The known bug above assumes `data.astDescription.content[].content[]` is the tree shape. This needs a live logged-in probe to confirm the exact node structure before the fix is finalized.

---

## Test Strategy

All new tools must have offline unit tests following the `tests/news.test.js` and `tests/options.test.js` patterns. `CLAUDE.md` mandates DI-mockable offline tests.

**For each `restFromNode` tool (financials, technicals, etf, bonds, community):**
```js
// Inject mock fetch returning canned scanner JSON
const fetch = async (url, opts) => {
  assert.ok(url.includes('scanner.tradingview.com/america/scan'));
  const body = JSON.parse(opts.body);
  assert.deepStrictEqual(body.symbols.tickers, ['NASDAQ:AMZN']);
  return { ok: true, json: async () => ({ totalCount: 1, data: [{ s: 'NASDAQ:AMZN', d: [27.8, 716924e9] }] }) };
};
const result = await fetchTechnicals({ symbol: 'NASDAQ:AMZN', columns: ['price_earnings_ttm', 'total_revenue'], _deps: { fetch } });
assert.strictEqual(result['price_earnings_ttm'], 27.8);
```

**For each `restFromRenderer` tool (documents_get_file):**
```js
const evaluateAsync = async () => ({ __ok: true, status: 200, data: { url: 'https://...' } });
const result = await getDocumentFile({ viewId: 'urn:report:quartr.com:123-abc', _deps: { evaluateAsync } });
```

**Required test cases per tool:**
1. URL / request body construction (assert correct endpoint, columns, headers)
2. Positional-array zip correctness (column count mismatch → error, not silent wrong data)
3. 429 → `REST_HTTP retryable:true` propagation
4. 403/401 soft-fail for `restFromRenderer` tools (documents_get_file)
5. Empty `data[]` → meaningful error (not uncaught `undefined` access)
6. Screener detection for at least one non-`america` exchange prefix

---

## References

| Source | URL | Role |
|--------|-----|------|
| TradingView Screener (Python) | https://github.com/shner-elmo/TradingView-Screener | Scanner endpoint/body schema, markets, cookie auth |
| tvscreener | https://github.com/deepentropy/tvscreener | Bond/Forex/Futures scanner wrappers |
| python-tradingview-ta | https://github.com/brian-the-dev/python-tradingview-ta | Technicals screener, `Recommend.*` column docs |
| Mathieu2301/Tradingview-API | https://github.com/Mathieu2301/Tradingview-API | Real-time WebSocket API (complementary) |
| TradingView ETF market page | https://www.tradingview.com/markets/etfs/funds-usa/ | Column reference |
| TradingView bond screener | https://www.tradingview.com/bond-screener/ | Column reference |

Live probes confirmed HTTP 200 (unauthenticated, 2026-06-28): `scanner.tradingview.com/america/scan` (ETFs via `type=fund` filter), `scanner.tradingview.com/bond/scan`, `scanner.tradingview.com/global/scan`, `scanner.tradingview.com/symbol` (Financials/Forecast), `news-mediator.tradingview.com/public/doc-screener/v1/documents`, `www.tradingview.com/api/v1/ideas/`, `www.tradingview.com/api/v2/minds/`, `news-headlines.tradingview.com/v2/view/headlines/symbol`.

Gated/blocked: `scanner.tradingview.com/options/scan` (HTTP 400), `symbol-search.tradingview.com/symbol_search/v3` (HTTP 403 from non-browser UA — repo passes `Origin`/`Referer` to mitigate).

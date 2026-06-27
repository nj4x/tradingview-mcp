# Phase 3 Report: Hidden Capabilities Discovery

**Date:** 2026-06-27  
**Method:** CDP runtime enumeration + cross-reference with existing implementations  
**Probe results:** 240 API paths discovered  

## Summary

Probed `window.TradingViewApi`, `window.ChartApiInstance`, `window.TradingView` and derived paths. Cross-referenced against 70 already-implemented tools. Below are the **top 5 candidates** for new MCP tool features, ranked by `Feasibility × 2 + Value × 2 + Effort × 1` (max 25 points).

---

## Top 5 Ranked Candidates

### 1. **Watchlist removal** — `watchlist_remove`
- **Score:** 24/25 (Feasibility: 5, Value: 5, Effort: 5)
- **API Path:** `window.TradingViewApi._watchlistApi` → right-click context menu → "Remove from Watchlist"
- **Probe Evidence:** `_watchlistApiDeferredPromise`, `_watchlistApiRejectionReason` exist; watchlist panel is DOM-driven
- **Current Status:** Blocked in Phase 2 — `watchlist_add` has no inversion (no API to remove by ID)
- **Implementation Sketch:**
  1. Hover watchlist symbol row
  2. Trigger right-click context menu (dispatch `contextmenu` CDP Input event at row coords)
  3. Click "Remove from Watchlist" option
  4. Poll watchlist until symbol disappears
- **Unit Test Outline:** Add → verify exists → Remove → verify gone
- **Risks:** Watchlist panel visibility; menu item text/positioning varies by language/region

### 2. **Strategy deep metrics** — `strategy_performance_metrics`
- **Score:** 21/25 (Feasibility: 4, Value: 5, Effort: 4)
- **API Path:** `window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().dataSources()` → find strategy → `.performance()`, `.ordersData()`, `.reportData()`
- **Probe Evidence:** `dataSources()` is a known path; returns array of study models; strategy studies expose performance metrics
- **Current Status:** Partially done — `data_get_strategy_results` scrapes the backtesting panel. This targets the live strategy data model instead.
- **Implementation Sketch:**
  1. Call `dataSources()` to get all visible studies
  2. Filter for studies with `.isStrategy()` or name match
  3. Extract `.performance().value()` (WatchedValue), `.ordersData()`, `.reportData()`
  4. Return structured metrics: Sharpe, drawdown, trade count, MAE/MFE per trade
- **Unit Test Outline:** Add a strategy → inject trades via replay → read performance metrics → assert > 0
- **Risks:** Strategy model schema varies by Pine version; `.performance()` may return null if not cached; `ordersData()` format is undocumented

### 3. **UI theme switching** — `ui_set_theme`, `ui_get_theme`
- **Score:** 18/25 (Feasibility: 4, Value: 3, Effort: 4)
- **API Path:** `window.TradingViewApi._themesApi` (exists)
- **Probe Evidence:** `_themesApi` object found; theme state is an app-level WatchedValue
- **Current Status:** Not implemented
- **Implementation Sketch:**
  1. `ui_get_theme`: Query `_themesApi.currentTheme()` or DOM `.body[data-theme]` attribute
  2. `ui_set_theme`: Call `_themesApi.setTheme(name)` with name: 'light' | 'dark' | 'custom'
  3. Poll DOM to confirm theme class changed
- **Unit Test Outline:** Get theme → switch to opposite → verify DOM → switch back
- **Risks:** `_themesApi` is marked `Deferred` in probe; may not be available until user navigates to settings; enum of valid theme names unknown

### 4. **Symbol search live (autocomplete)** — `symbol_search_live` ✅ SELECTED FOR IMPLEMENTATION
- **Score:** 17/25 (Feasibility: 4, Value: 4, Effort: 3)
- **API Path:** `window.TradingViewApi.searchSymbols(query)` (returns a Promise; call via `evaluateAsync`)
- **Probe Evidence (verified live 2026-06-27):** Function exists and resolves to `{ symbols_remaining: <int>, symbols: [ {...} ] }` (50 results for 'AAPL'). This is the in-renderer, **logged-in-session** search — distinct from the existing `symbol_search` which uses a Node-side anonymous `fetch` to `symbol-search.tradingview.com`.
- **Verified item shape** (per `symbols[]` entry): `symbol`, `description`, `type` (e.g. `commodity`, `stock`), `exchange`, `currency_code`, `provider_id`, `source_id`, `source2: {id, name, description}`, `typespecs: [...]`, plus logo fields. Note: `description` may contain `<em>` highlight tags — strip them.
- **Current Status:** Complementary to existing `symbol_search` (which scrapes anonymously). This reflects the user's logged-in catalog.
- **Implementation Sketch:**
  1. `symbol_search_live({ query })`: `safeString()` the query, call `window.TradingViewApi.searchSymbols(<query>)` via `evaluateAsync`.
  2. Map `result.symbols` → compact `{ symbol, description (em-stripped), type, exchange, currency_code }`, cap at 15.
  3. Return `{ success, query, source: 'searchSymbols', count, results }`.
- **Unit Test Outline:** DI-mock `evaluateAsync` returning a canned `{symbols:[...]}` → assert query is `safeString`-escaped in the expression, `<em>` stripped, results capped at 15.
- **Risks:** Requires logged-in session; resolves async (must use `evaluateAsync`, not `evaluate` — a plain `evaluate` returns `{}` because it doesn't await the Promise).

### 5. **News headlines + story** — `news_get_headlines`, `news_get_story` ✅ SELECTED FOR IMPLEMENTATION
- **Score:** 22/25 (Feasibility: 5, Value: 5, Effort: 4)
- **API Path:** TradingView news REST service, called from **inside the renderer** via `fetch(url, { credentials: 'include' })` to carry the logged-in session cookie
  - Headlines: `https://news-headlines.tradingview.com/v2/view/headlines/symbol?client=overview&lang=en&symbol=<pro_name>`
  - Story body: `https://news-headlines.tradingview.com/v2/story?id=<id>&lang=en`
- **Probe Evidence (verified live 2026-06-27):**
  - The JS-object API is a **dead end**: `_newsApiDeferredPromise` resolves to `null`, `_newsApi` is undefined. Do NOT pursue the object API.
  - The REST path works: headlines returns HTTP 200 with `{ items: [...] }` (25 items for `KRAKEN:BTCUSD`); story returns HTTP 200 with a full article payload.
- **Symbol resolution gotcha (critical):** The `symbol` query param MUST be the listing exchange's `pro_name`, obtained from `window.TradingViewApi.activeChart().symbolExt().pro_name` (e.g. `NASDAQ:AMZN`, `KRAKEN:BTCUSD`). Passing the *display* exchange (e.g. `BATS:AMZN`) returns an **empty `{items:[]}` with a silent 200 OK** — no error, just no data. Always derive `pro_name` from `symbolExt()`, never construct the symbol string by hand.
- **Headlines response shape** (per item): `id`, `title`, `provider`, `source`, `sourceLogoId`, `published` (unix seconds), `urgency`, `link`, `relatedSymbols: [{symbol, ...}]`, `storyPath`.
- **Story response shape:** top-level `title`, `provider`, `source`, `published`, `link`, `shortDescription`, `relatedSymbols`, `tags`, and `astDescription` — a tree `{ type: 'root', children: [...] }` where each child is `{ type: 'p'|..., children: [string | node] }`. Flatten `astDescription` recursively to plain text for the body (the live BTC story had 32 paragraph nodes).
- **Implementation Sketch:**
  - `news_get_headlines({ symbol?, limit=25 })`: resolve `pro_name` (use `symbolExt()` when `symbol` omitted, else `safeString()` the passed symbol), `fetch` headlines, map items to compact `{ id, title, provider, published, urgency, relatedSymbols }`, cap at `limit`.
  - `news_get_story({ id })`: `safeString()` the id, `fetch` story, return `{ title, provider, published, link, body }` where `body` is the flattened `astDescription` text.
- **Unit Test Outline:** DI-mock `evaluateAsync` → assert generated expression contains the right endpoint + `credentials:'include'` + escaped symbol/id; assert mapper flattens AST and caps headlines.
- **Risks:** Requires logged-in session (cookie); endpoint is unofficial and may change; `astDescription` node types beyond `p` (lists, quotes, embedded symbols) need a generic recursive flattener, not a `p`-only walk.

> **Note:** The previous #5 candidate, `stream_realtime` (WebSocket frame decoding, 16/25), was **discarded** by user decision (binary RE effort too high, needs live market hours). News replaces it and ranks higher.

---

## Lower-Ranked Candidates (6-10)

| Rank | Feature | API Path | Score | Rationale |
|------|---------|----------|-------|-----------|
| 6 | **Pane sync (multi-monitor)** | `window.TradingView.bottomWidgetBar` + DOM layout manager | 15/25 | UI-heavy; synchronization logic is complex; platform-specific (Desktop only) |
| 7 | **Alert firing history** | `_alertService._alertsList` → alert objects w/ `.trigger_count`, `.last_fired_at` | 14/25 | Feasibility 3 (alerts are ephemeral); low value for scripting |
| 8 | **Study template enumeration** | `_studyTemplatesDrawer.getList()` | 13/25 | Feasibility 2 (_drawer is a UI widget); niche use case |
| 9 | **DOM layout persistence** | `window.TradingView.saveDefaults()` + custom layout saving | 12/25 | Feasibility 3 (API exists); complex layout state; low priority |
| 10 | **Replay history playback** | `_replayApi.loadHistoryRange(start, end)` (inferred) | 11/25 | Feasibility 2 (no direct evidence); high effort; limited use case |

---

## Scoring Rubric Applied

Each candidate scored on three dimensions (1-5 scale):

- **Feasibility** (×2): documented method (5) → internal `_` path used elsewhere (3) → deeply private/undocumented (1). **Candidates with Feasibility < 2 are rejected.**
- **Value** (×2): repeatedly needed, reduces polling (5) → nice-to-have, saves a few clicks (1)
- **Effort** (×1, inverse): <30 lines, existing DI pattern (5) → new modal/state handling, cloud writes (1)

---

## Next Steps for User Review

1. **Approve a top-5 candidate** → assign to implementation backlog
2. **For #5 (WebSocket streaming):**
   - Provide sample WS frame hex dump to help with reverse engineering
   - Set expectation: decode work is empirical (capture live frames, decode by trial)
   - Consider deferring until live market hours for testing
3. **For #1 (watchlist_remove):**
   - Unblock Phase 2 watchlist tests
   - Implement right-click context menu interaction (new UI automation pattern)
4. **For #2 (strategy metrics):**
   - Requires live strategy on chart for testing
   - Verify performance() WatchedValue is always available post-compile

---

## Observability for Next Phase

The Phase 1 diagnostics infrastructure is now ready for deep API investigation:

```bash
# Run probe with detailed logging:
TV_MCP_NETWORK=1 npm start &
node scripts/probe_api.js
tv diagnostics -f --type network_response  # watch REST calls during probe
```

Captured WS frames are stored in `~/.tradingview-mcp/logs/diagnostics/session_*.jsonl` with type `ws_frame` — use to reverse-engineer the binary format.

---

## Files

- Probe results: `/Users/heraroma/.tradingview-mcp/logs/probe/probe_2026-06-27T19-20-37.jsonl` (240 paths)
- Probe script: `scripts/probe_api.js` (reusable for future discoveries)

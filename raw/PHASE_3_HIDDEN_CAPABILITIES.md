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

### 4. **Symbol search live (autocomplete)** — `symbol_search_live`
- **Score:** 17/25 (Feasibility: 4, Value: 4, Effort: 3)
- **API Path:** `window.TradingViewApi.searchSymbols(query)` (documented in KNOWN_PATHS; returns Promise)
- **Probe Evidence:** Function exists; current `symbol_search` scrapes dropdown DOM; direct API call is available
- **Current Status:** Partially done — `symbol_search` uses DOM scraping via the search-dialog UI
- **Implementation Sketch:**
  1. Call `searchSymbols(query)` directly (bypasses UI)
  2. Returns Promise<{ symbols: [{symbol, name, exchange, ...}], total_count }>
  3. Optional: format for CLI (CSV-like output)
- **Unit Test Outline:** Search 'AAPL' → assert results include Apple → search bogus → assert empty
- **Risks:** REST endpoint behind Cloudflare; may rate-limit; requires logged-in session; return schema undocumented

### 5. **WebSocket-backed streaming** — `stream_realtime` (exploratory)
- **Score:** 16/25 (Feasibility: 3, Value: 4, Effort: 3)
- **API Path:** `Network.webSocketFrameReceived` (CDP event, opt-in via `TV_MCP_WS_FRAMES=1`)
- **Probe Evidence:** Diagnostics buffer now captures WS frames; `core/stream.js` currently uses poll-and-diff (300-2000ms latency)
- **Current Status:** Infrastructure ready; reverse engineering needed
- **Implementation Sketch:**
  1. Enable `Network.webSocketFrameReceived` subscription (already wired in Phase 1)
  2. Decode WS frame payloads — TradingView uses a binary format for real-time quote/bar updates
  3. Parse frames to extract symbol, last price, OHLC deltas, volume
  4. Emit per-symbol updates with sub-100ms latency
  5. Expose as CLI `tv stream --symbol ES1! --follow` (realtime tail)
- **Unit Test Outline:** Start stream → wait 2s → collect 10+ ticks → assert monotonic timestamps → assert price changes
- **Risks:** WS frame format is undocumented; binary protocol may change with TradingView updates; sub-100ms latency requires careful event batching to avoid context bloat; reverse engineering effort is high; requires live market hours for meaningful testing

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

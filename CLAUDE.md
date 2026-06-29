# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# TradingView MCP — Claude Instructions

99 tools for reading and controlling a live TradingView Desktop chart via CDP (port 9222). The MCP server advertises 22 by default and all 99 with `TV_MCP_EXTENDED=1` (the gate is `src/tools/_groups.js`).

## Development Commands

```bash
npm start              # Run the MCP server (stdio transport) — what Claude Code connects to

# Tests (node:test, zero test deps)
npm test               # e2e + pine_analyze (e2e REQUIRES live TradingView on port 9222)
npm run test:unit      # full offline suite (pine, sanitization, pool, withtab, phases 1-3, etc.) — no live TradingView needed
npm run test:concurrent  # pool concurrency e2e (needs live TV; skips gracefully if tab creation unsupported)
npm run test:ctool       # concurrent multi-tool integration (CT-1..CT-5; needs live TV)
node --test tests/sanitization.test.js   # injection-safety unit tests (offline, DI mocks)
node --test --test-name-pattern="safeString" tests/sanitization.test.js  # single test
```

`tests/e2e.test.js`, `tests/replay.test.js`, and `tests/concurrent.e2e.test.js` drive a real chart over CDP and will fail (or skip gracefully) without TradingView Desktop launched with `--remote-debugging-port=9222` (use the `tv_launch` tool or `scripts/launch_tv_debug_*`). `sanitization.test.js` and `pine_analyze.test.js` run offline.

`npm run test:concurrent` — pool concurrency tests (distinct tabs, queue-blocking, drain cleanup). These require race-safe tab creation (`PUT /json/new` OR the two-step `window.open` path in `cdpDiscovery.js`); they skip gracefully if neither works on the running build. On this Electron build `PUT /json/new` and `Target.createTarget` are unsupported, so tab growth uses `window.open('about:blank')` from the pool's primary tab, then navigates the blank tab via `location.href` (a navigating `window.open` or any URL `#hash` crashes TV's `BrowserView.autoResize`).

## Codebase Architecture

Three layers, each tool exists in all three (e.g. `chart`):

1. **`src/tools/*.js`** — MCP tool registration. Thin Zod-validated wrappers that call core and wrap the result in `jsonResult()` (`src/tools/_format.js`). `src/server.js` calls every `register*Tools(server)`. Adding a tool = add to the core module + register here.
2. **`src/core/*.js`** — all real logic. Each function builds a JavaScript expression string and runs it in the TradingView renderer via `evaluate()`. Exported from `src/core/index.js` as the public `./core` package entry.
3. **`src/connection.js`** — single CDP client (singleton in `client`). `evaluate(expr)` / `evaluateAsync(expr)` send `Runtime.evaluate` to the chart target found by URL match. `KNOWN_PATHS` holds the discovered internal API paths (e.g. `window.TradingViewApi._activeChartWidgetWV.value()`).

### Two hard conventions when writing core functions

- **CDP injection safety is mandatory.** Any user value interpolated into an `evaluate()` expression string MUST go through `safeString()` (string → escaped JS literal) or `requireFinite()` (number validation). Never template a raw user string into evaluated JS. `tests/sanitization.test.js` enforces this.
- **Dependency injection for testability.** Core functions take an optional `_deps` (or destructure it) and resolve real vs. mocked implementations via a local `_resolve(deps)` helper (see `src/core/chart.js`, `src/core/drawing.js`). Tests inject mock `evaluate` to assert on the generated expression strings without a live chart.

Chart readiness: after navigation, `src/wait.js` `waitForChartReady()` polls the DOM for loading spinners / bar-count stability before returning.

## Decision Tree — Which Tool When

### "What's on my chart right now?"
1. `chart_get_state` → symbol, timeframe, chart type, list of all indicators with entity IDs
2. `data_get_study_values` → current numeric values from all visible indicators (RSI, MACD, BBands, EMAs, etc.)
3. `quote_get` → real-time price, OHLC, volume for current symbol

### "What levels/lines/labels are showing?"
Custom Pine indicators draw with `line.new()`, `label.new()`, `table.new()`, `box.new()`. These are invisible to normal data tools. Use:

1. `data_get_pine_lines` → horizontal price levels drawn by indicators (deduplicated, sorted high→low)
2. `data_get_pine_labels` → text annotations with prices (e.g., "PDH 24550", "Bias Long ✓")
3. `data_get_pine_tables` → table data formatted as rows (e.g., session stats, analytics dashboards)
4. `data_get_pine_boxes` → price zones / ranges as {high, low} pairs

Use `study_filter` parameter to target a specific indicator by name substring (e.g., `study_filter: "Profiler"`).

### "Give me price data"
- `data_get_ohlcv` with `summary: true` → compact stats (high, low, range, change%, avg volume, last 5 bars)
- `data_get_ohlcv` without summary → all bars (use `count` to limit, default 100)
- `quote_get` → single latest price snapshot

### "Analyze my chart" (full report workflow)
1. `quote_get` → current price
2. `data_get_study_values` → all indicator readings
3. `data_get_pine_lines` → key price levels from custom indicators
4. `data_get_pine_labels` → labeled levels with context (e.g., "Settlement", "ASN O/U")
5. `data_get_pine_tables` → session stats, analytics tables
6. `data_get_ohlcv` with `summary: true` → price action summary
7. `capture_screenshot` → visual confirmation

### "Change the chart"
- `chart_set_symbol` → switch ticker (e.g., "AAPL", "ES1!", "NYMEX:CL1!")
- `chart_set_timeframe` → switch resolution (e.g., "1", "5", "15", "60", "D", "W")
- `chart_set_type` → switch chart style (Candles, HeikinAshi, Line, Area, Renko, etc.)
- `chart_manage_indicator` → add or remove studies (use full name: "Relative Strength Index", not "RSI")
- `chart_scroll_to_date` → jump to a date (ISO format: "2025-01-15")
- `chart_set_visible_range` → zoom to exact date range (unix timestamps)

### "Work on Pine Script"
1. `pine_set_source` → inject code into editor
2. `pine_smart_compile` → compile with auto-detection + error check
3. `pine_get_errors` → read compilation errors
4. `pine_get_console` → read log.info() output
5. `pine_get_source` → read current code back (WARNING: can be very large for complex scripts)
6. `pine_save` → save to TradingView cloud
7. `pine_new` → create blank indicator/strategy/library
8. `pine_open` → load a saved script by name

### "Practice trading with replay"
1. `replay_start` with `date: "2025-03-01"` → enter replay mode
2. `replay_step` → advance one bar
3. `replay_autoplay` → auto-advance (set speed with `speed` param in ms)
4. `replay_trade` with `action: "buy"/"sell"/"close"` → execute trades
5. `replay_status` → check position, P&L, current date
6. `replay_stop` → return to realtime

### "Screen multiple symbols"
- `batch_run` with `symbols: ["ES1!", "NQ1!", "YM1!"]` and `action: "screenshot"` or `"get_ohlcv"`

### "Get news for a symbol"
- `news_get_headlines` → recent headlines for the current chart symbol (or pass `symbol` as a `pro_name` like "NASDAQ:AMZN"). Returns id, title, provider, published, urgency.
- `news_get_story` → full article body text for a headline `id` from `news_get_headlines`
- Both read TradingView's logged-in news feed; the chart must have a symbol loaded

### "Search symbols (logged-in catalog)"
- `symbol_search_live` → autocomplete against the logged-in session (`searchSymbols`), complements the anonymous `symbol_search`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` → see what's drawn
- `draw_remove_one` → remove by ID
- `draw_clear` → remove all

### "Manage alerts"
- `alert_create` → set price alert (condition: "crossing", "greater_than", "less_than")
- `alert_list` → view active alerts
- `alert_delete` → remove alerts

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` → load a saved layout by name
- `ui_fullscreen` → toggle fullscreen
- `capture_screenshot` → take a screenshot (regions: "full", "chart", "strategy_tester")

### "TradingView isn't running"
- `tv_launch` → auto-detect and launch TradingView with CDP on Mac/Win/Linux
- `tv_health_check` → verify connection is working

## Context Management Rules

These tools can return large payloads. Follow these rules to avoid context bloat:

1. **Always use `summary: true` on `data_get_ohlcv`** unless you specifically need individual bars
2. **Always use `study_filter`** on pine tools when you know which indicator you want — don't scan all studies unnecessarily
3. **Never use `verbose: true`** on pine tools unless the user specifically asks for raw drawing data with IDs/colors
4. **Avoid calling `pine_get_source`** on complex scripts — it can return 200KB+. Only read if you need to edit the code.
5. **Avoid calling `data_get_indicator`** on protected/encrypted indicators — their inputs are encoded blobs. Use `data_get_study_values` instead for current values.
6. **Use `capture_screenshot`** for visual context instead of pulling large datasets — a screenshot is ~300KB but gives you the full visual picture
7. **Call `chart_get_state` once** at the start to get entity IDs, then reference them — don't re-call repeatedly
8. **Cap your OHLCV requests** — `count: 20` for quick analysis, `count: 100` for deeper work, `count: 500` only when specifically needed

### Output Size Estimates (compact mode)
| Tool | Typical Output |
|------|---------------|
| `quote_get` | ~200 bytes |
| `data_get_study_values` | ~500 bytes (all indicators) |
| `data_get_pine_lines` | ~1-3 KB per study (deduplicated levels) |
| `data_get_pine_labels` | ~2-5 KB per study (capped at 50) |
| `data_get_pine_tables` | ~1-4 KB per study (formatted rows) |
| `data_get_pine_boxes` | ~1-2 KB per study (deduplicated zones) |
| `data_get_ohlcv` (summary) | ~500 bytes |
| `data_get_ohlcv` (100 bars) | ~8 KB |
| `capture_screenshot` | ~300 bytes (returns file path, not image data) |

## Tool Conventions

- All tools return `{ success: true/false, ... }`
- Entity IDs (from `chart_get_state`) are session-specific — don't cache across sessions
- Pine indicators must be **visible** on chart for pine graphics tools to read their data
- `chart_manage_indicator` requires **full indicator names**: "Relative Strength Index" not "RSI", "Moving Average Exponential" not "EMA", "Bollinger Bands" not "BB"
- Screenshots save to `screenshots/` directory with timestamps
- OHLCV capped at 500 bars, trades at 20 per request
- Pine labels capped at 50 per study by default (pass `max_labels` to override)

## Architecture

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

Pine graphics path: `study._graphics._primitivesCollection.dwglines.get('lines').get(false)._primitivesDataById`

## Debugging & Observability

### Launch TradingView with maximum logging

```bash
# Full verbose launch with all logs
ELECTRON_ENABLE_LOGGING=1 /Applications/TradingView.app/Contents/MacOS/TradingView \
  --remote-debugging-port=9222 \
  --enable-logging=stderr \
  --v=2 \
  --vmodule=*/net/*=2,*/url/*=2

# Or with output captured to file
ELECTRON_ENABLE_LOGGING=1 /Applications/TradingView.app/Contents/MacOS/TradingView \
  --remote-debugging-port=9222 \
  --enable-logging=stderr \
  --v=2 \
  2>&1 | tee tradingview_debug.log &
```

**What each flag does:**
- `ELECTRON_ENABLE_LOGGING=1` — pipes Electron renderer console to stdout/stderr
- `--remote-debugging-port=9222` — enables Chrome DevTools Protocol (required by this project)
- `--enable-logging=stderr` — Chromium verbose logs to stderr
- `--v=2` — verbosity level 2 (use `--v=3` for extreme verbosity)
- `--vmodule=*/net/*=2,*/url/*=2` — target specific modules (network, URL handling)

### Monitor native/OS-level logs (macOS, in parallel terminal)

```bash
log stream --predicate 'process == "TradingView"' --level debug --style compact
```

Captures native crashes, Electron internals, and OS signals not in the JS console.

### Interactive DevTools (zero code required)

With the app running on port 9222, open Chrome and navigate to:
```
chrome://inspect
```
Then:
1. Click "Configure" → add `localhost:9222`
2. The TradingView renderer appears under "Remote Target"
3. Click **Inspect** → full DevTools (Console, Network, Performance, Sources, Memory, Application)

Or directly open the DevTools frontend (substitute the actual target ID from `curl http://localhost:9222/json/list`):
```
devtools://devtools/bundled/inspector.html?ws=127.0.0.1:9222/devtools/page/<TARGET_ID>
```

**Use DevTools to:**
- **Console tab** — watch TradingView's JS logs and errors in real-time
- **Network tab** — inspect REST API calls and WebSocket frames (market data streaming)
- **Performance tab** — profile chart rendering performance, detect memory leaks
- **Sources tab** — set breakpoints in TradingView's JS (may help diagnose hang/crash)

Multiple clients can attach simultaneously, so DevTools and the MCP server both work at the same time.

### Enable TradingView charting-library debug mode

Once the app is running, flip debug mode at runtime via the DevTools console or CDP:
```bash
# Via Chrome DevTools Console (navigate to chrome://inspect, open the TradingView renderer):
window.TradingViewApi._activeChartWidgetWV.value().setDebugMode(true)
```

This unlocks detailed datafeed processing logs in the renderer console, visible in the Chrome DevTools Console tab.

### What to look for when debugging

- **Console errors** — uncaught exceptions (DevTools → Console, or `ELECTRON_ENABLE_LOGGING=1` stdout)
- **Network waterfall** — WebSocket frames (TradingView's realtime quote/bar feed) in DevTools Network tab
- **Performance** — long tasks / jank (DevTools Performance tab, or `Performance.getMetrics`)
- **Crashes** — native minidumps in `~/Library/Application Support/TradingView/Crashpad/` (on macOS)
- **Memory leaks** — heap growth over time (DevTools Memory tab, or subscribe to `Performance` CDP events)

### CDP domains in use

The project connects to TradingView's renderer via Chrome DevTools Protocol (`src/connection.js`):
- **`Runtime.enable`** + **`Runtime.evaluate`** — execute JS in the renderer (the core mechanism for all 99 tools)
- **`Page.enable`** + **`Page.captureScreenshot`** — take screenshots
- **`DOM.enable`** — (enabled but primarily queried via `Runtime.evaluate`, not CDP DOM domain)

For richer observability, the architecture could subscribe to:
- **`Runtime.consoleAPICalled`** — capture `console.*` calls from the renderer
- **`Runtime.exceptionThrown`** — uncaught exceptions with stack traces
- **`Network.webSocketFrameReceived`** — raw WebSocket frames (TradingView's market-data feed)
- **`Log.entryAdded`** — browser-level entries (network failures, CSP, deprecations)
- **`Performance.getMetrics`** — runtime metrics (heap size, DOM nodes, task counts)

### Structured diagnostics (CDP event capture)

Run the MCP server normally — it auto-captures CDP events (console, exceptions, browser log) to a ring buffer in memory and writes a JSONL session log to `~/.tradingview-mcp/logs/diagnostics/`.

For verbose native Electron + Chromium logs, use the observable launch script instead of the standard debug one:

```bash
# Standard (CDP only):
./scripts/launch_tv_debug_mac.sh

# Observable (CDP + verbose Electron logs teed to ~/.tradingview-mcp/logs/native/):
./scripts/launch_tv_observable.sh
./scripts/launch_tv_observable.sh --v=2        # extra verbose
./scripts/launch_tv_observable.sh --devtools   # auto-open DevTools tab
```

Opt-in env flags (set before starting the MCP server):

```bash
TV_MCP_NETWORK=1 npm start          # enable Network responses/failures for chart/datafeed URLs
TV_MCP_NETWORK=1 TV_MCP_WS_FRAMES=1 npm start   # also capture WebSocket frames
TV_MCP_EXTENDED=1 npm start         # expose all 88 tools (default: 12 chart+data tools)
```

The flag only gates which tools the MCP server advertises over stdio. An unrecognized value (e.g. `TV_MCP_EXTENDED=foo`) prints a stderr warning and falls back to the default 12-tool mode.

Event types in the buffer: `session_start`, `console`, `exception`, `log`, `network_response`, `network_failed`, `ws_frame`.

## CDP Connection Pool (concurrency)

The MCP server fronts CDP with a **connection pool** so multiple agents can fetch data
for different symbols/timeframes concurrently, each on its own TradingView tab. Tools
lease a tab via `withTab(fn, { route })` (`src/core/withTab.js`); the pool
(`src/core/CdpPool.js`) adopts the user's existing chart as the **primary** (slot 0) and
grows throwaway **worker** tabs up to `TV_MCP_MAX_TABS`. At capacity, a request **blocks
on a queue** (it does not fail) until a tab frees — then proceeds. Worker tabs the server
created are closed on clean shutdown (SIGINT/SIGTERM `drain()`); the user's adopted
primary is never closed.

**Routing intent** (`route` passed to `withTab`):

| Route | Meaning | Tools |
|-------|---------|-------|
| `visible` | the primary/user-facing tab (slot 0); serializes user-visible ops | `chart_*`, `data_*`, `quote_get`, `draw_*`, `ui_*`, `pine_*`, `capture_screenshot`, `indicator_*`, `pane_*`, `watchlist_*`, `alert_*`, `market_status`, `symbol_info` |
| `headless` | any worker tab; grows on demand, queues at capacity | `chart_fetch_ohlcv`, `symbol_search*`, `batch_run`, `news_*`, `options_search` |
| replay lock | global exclusive lock + pinned visible tab via `ReplaySession` | `replay_*` |

Tool errors now carry a stable `{ code, retryable }` (see `src/core/TvError.js`): codes
`POOL_EXHAUSTED`, `POOL_DRAINING`, `CHART_TIMEOUT` are `retryable: true` (back off and
retry); `CDP_DOWN`, `TARGET_GONE`, `JS_EVAL`, `REPLAY_ACTIVE` are not.

Pool env flags:

| Var | Default | Effect |
|-----|---------|--------|
| `TV_MCP_MAX_TABS` | `5` | Max concurrent tabs incl. primary. `1` = serial-but-pooled. Min 1. On first connect the pool inventories already-open chart tabs and adopts them (up to this cap); adopted tabs are never auto-closed on drain/TTL. |
| `TV_MCP_TAB_TIMEOUT_MS` | `20000` | How long `acquire()` queues before `POOL_EXHAUSTED`. |
| `TV_MCP_EVAL_TIMEOUT_MS` | `15000` | Per-op `evaluate()` timeout inside a tab's serial queue. |
| `TV_MCP_DRAIN_TIMEOUT_MS` | `8000` | `drain()` deadline before force-closing leased tabs. |
| `TV_MCP_REPLAY_EXPIRY_MS` | `600000` | Idle auto-expiry for a forgotten replay session (releases the global lock). |
| `TV_MCP_STRICT_DI` | _(unset)_ | `=1` → resolver throws on a missing `_deps` instead of falling back to the singleton (CI/DI gate). |
| `TV_MCP_POOL` | _(unset)_ | `=0` → **bypass the pool**, use the legacy `getClient()` singleton (rollback lever). |
| `TV_MCP_WORKER_TTL_MS` | `300000` | Idle-worker tab TTL in ms (default 5 min). `=0` disables TTL eviction. Worker tabs idle longer than this are closed automatically; the primary (adopted user tab) is never evicted. |
| `TV_MCP_FRESH_TIMEOUT_MS` | `8000` | `chart_fetch_ohlcv` bar-freshness gate: max time to wait for the series to swap to the requested symbol/timeframe and settle (and, on a live-tradable market, become current) before reading bars. |
| `TV_MCP_STRICT_FRESH` | _(unset)_ | `=1` → `chart_fetch_ohlcv` throws a retryable `CHART_TIMEOUT` when freshness can't be confirmed. Default returns the data with `fresh:false` + a `warning` (non-breaking). |

**Bar-freshness gate (`chart_fetch_ohlcv`):** after a symbol/timeframe switch on a headless
worker tab, the renderer briefly still holds the *previous* series (datafeed loads history first,
then subscribes realtime), so an immediate bar read can return stale bars that catch up seconds
later. `fetchOhlcv` now calls `waitForBarsFresh` (`src/wait.js`) before reading: it polls the main
series until (1) `chart.symbol()`/`chart.resolution()` match the request (normalized — tolerant of
`D`↔`1D` and exchange prefixes), (2) `(lastBarOpenTime, size)` hold stable across consecutive
polls, and (3) — only when `chart.isMarketAvailable()` is true — the last bar is within ~3×
the resolution interval of now (skipped for closed markets so weekends/holidays never false-fail).
The result carries `fresh`, `last_bar_time`, and `freshness_waited_ms`. The gate runs even on the
no-switch path, since an affinity-reused idle tab can hold a stale series. Bar times are normalized
defensively (values `> 1e12` are treated as milliseconds).

**Symbol affinity (headless routing):** a `headless` acquire prefers an idle **worker**
tab already loaded on the requested symbol, avoiding a redundant reload. Affinity applies
to worker tabs only — the user's visible primary is never stolen for a headless op; if no
worker matches, acquire falls through to normal worker selection (reuse, grow, or queue).
Each connection's `conn.symbol` is updated lazily via `setSymbolHint` after `setSymbol`,
`getState`, `fetchOhlcv`, `getMarketStatus`, and `symbolInfo` succeed (only post-success,
so a failed switch never leaves a stale/poisoned symbol on the tab).

`npm run test:ctool` — concurrent multi-tool integration tests (CT-1..CT-5). Requires live TradingView on `--remote-debugging-port=9222`. Tests prove simultaneous operations on distinct tabs (CT-1/CT-2), tab reuse (CT-3), and TTL-based idle eviction (CT-4/CT-5). All tests use private pool instances — no global singleton is touched.

## REST-First Architecture & Migration

**Doctrine:** TradingView MCP prefers direct REST API endpoints over GUI/DOM manipulation wherever a stable endpoint exists. The REST framework (`src/core/_rest.js`) provides two execution modes:
- **`restFromRenderer(evaluateAsync, url)`** — fetches authenticated endpoints FROM the logged-in renderer (carries session cookie)
- **`restFromNode(fetch, url)`** — fetches public, unauthenticated endpoints FROM Node (e.g., symbol-search.tradingview.com)

### Migration Status

| Tool | Endpoint | Status | Source Field | Notes |
|------|----------|--------|--------------|-------|
| `news_get_headlines` | pine-facade / market-news | REST-only | `rest_api` | no CDP fallback; throws REST_DISABLED if TV_MCP_REST=0 |
| `news_get_story` | market-news detail | REST-only | `data.source` (outlet) | no CDP fallback |
| `alert_list` | alerts-facade | REST-only | `rest_api` | soft-failure: returns empty list + error on REST failure, never throws |
| `alert_create` / `alert_delete` | alerts-facade | CDP-only | (N/A) | deferred; CDP-driven mutations |
| `pine_list_scripts` | pine-facade | REST-only | `rest_api` | no CDP fallback; throws REST_DISABLED if TV_MCP_REST=0 |
| `pine_*` (others) | (N/A) | CDP-only | `cdp` / `internal_api` | compile, save, deploy remain renderer-driven |
| `symbol_search` | symbol-search.tradingview.com | REST-only | `rest_api` | public endpoint, fetched from Node |
| `symbol_search_live` | (logged-in searchSymbols) | REST-only | `searchSymbols` | authenticated, fetched from renderer |
| `symbol_info` | (logged-in REST) | REST → CDP | `cdp` | info route not yet migrated; fallback to CDP |
| `quote_get` | (logged-in REST) | REST → CDP | `cdp` | quote route not yet migrated; fallback to CDP |
| `market_status` | (logged-in REST) | REST → CDP | `cdp` | session status route not yet migrated; fallback to CDP |
| `options_search` | options data API | REST-first | `rest_api` / `searchSymbols` | tier-1 uses Node REST; tier-2 uses renderer |
| `watchlist_get` | symbols-list-custom API | REST-first | `rest_api` | auto-fallback to CDP (panel read) on REST failure |
| `chart_fetch_ohlcv` | (internal datafeed REST) | REST-only | N/A | uses internal TradingView datafeed REST |

### Rollback & Disabled-REST Contract

**Global disable flag:** Set `TV_MCP_REST=0` to force all migrated tools onto their CDP fallback path (if one exists). Tools without a fallback will throw `TvError('REST_DISABLED')`.

**Soft-failure vs. hard-error:**
- **Hard-error tools** (news, pine, alerts.list): throw `TvError('REST_DISABLED')` when TV_MCP_REST=0 and no fallback exists. Caller must handle.
- **Soft-failure tools** (alerts.list only): catch REST errors and return `{ success: true, ..., error: "message" }` instead of throwing. This preserves backward compatibility for tools that should never crash the user's workflow.

### Dependency Injection & Testability

All REST-migrated core functions take `{ _deps } = {}` and resolve via `makeResolver()`:
```js
export async function listScripts({ _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  assertRestEnabled('pine_list_scripts');
  const data = await restFromRenderer(evaluateAsync, url);
  // ...
}
```

**Strict-DI mode** (`TV_MCP_STRICT_DI=1`): resolver throws if `_deps` is missing and a resolved dep is destructured. Catches tools that accidentally bypassed DI.

Tests inject mock `evaluateAsync` via `_deps` to avoid real network calls:
```js
const evaluateAsync = async () => ({ __ok: true, status: 200, data: [...] });
const result = await listScripts({ _deps: { evaluateAsync } });
```

### Source Field Convention

All REST returns include a `source` field for caller transparency:
- **`"rest_api"`** — data came from a TradingView REST endpoint
- **`"cdp"`** — data came from a CDP evaluate() expression
- **`"searchSymbols"`** — data came from the renderer's searchSymbols API (tier-2 fallback for symbol_search)
- **`"internal_api"`** — deprecated; renamed to `"rest_api"` in the REST migration

### Error Handling

**Rest HTTP errors** (`TvError('REST_HTTP')`):
- Retryable for 429 (rate limit) and 5xx (server errors)
- Non-retryable for 4xx client errors (auth, not found, validation)

**Missing REST support** (`TvError('REST_DISABLED')`):
- Non-retryable; caller must handle
- Only thrown when TV_MCP_REST=0 and the tool has no CDP fallback

**Envelope protocol:**
- Renderer fetch returns `{ __ok: boolean, status: number, data: any }` or `{ __error: string }`
- Node fetch returns standard Response; throws on !resp.ok
- Both routes normalize to TvError + code/retryable for consistent caller handling

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# TradingView MCP — Claude Instructions

MCP server connecting Claude to TradingView Desktop via CDP (port 9222).

## Development Commands

```bash
npm start              # Run the MCP server (stdio transport)

# Tests (node:test, zero test deps)
npm test               # e2e + pine_analyze (REQUIRES live TradingView on port 9222)
npm run test:unit      # full offline suite — no live TradingView needed
npm run test:concurrent  # pool concurrency e2e (needs live TV)
npm run test:ctool       # concurrent multi-tool integration (CT-1..CT-5; needs live TV)
node --test tests/sanitization.test.js   # injection-safety unit tests (offline)
node --test --test-name-pattern="safeString" tests/sanitization.test.js  # single test
```

e2e tests require TradingView Desktop with `--remote-debugging-port=9222`. `sanitization.test.js` and `pine_analyze.test.js` run offline.

## Codebase Architecture

Three layers, each tool exists in all three (e.g. `chart`):

1. **`src/tools/*.js`** — MCP tool registration. Thin Zod-validated wrappers that call core and wrap the result in `jsonResult()` (`src/tools/_format.js`). `src/server.js` calls every `register*Tools(server)`. Adding a tool = add to the core module + register here.
2. **`src/core/*.js`** — all real logic. Each function builds a JavaScript expression string and runs it in the TradingView renderer via `evaluate()`. Exported from `src/core/index.js` as the public `./core` package entry.
3. **`src/connection.js`** — single CDP client (singleton in `client`). `evaluate(expr)` / `evaluateAsync(expr)` send `Runtime.evaluate` to the chart target found by URL match. `KNOWN_PATHS` holds the discovered internal API paths.

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
- `news_get_headlines` → recent headlines (pass `symbol` as `pro_name` like "NASDAQ:AMZN")
- `news_get_story` → full article body for a headline `id`

### "Search symbols (logged-in catalog)"
- `symbol_search_live` → autocomplete against the logged-in session, complements `symbol_search`

### "Draw on the chart"
- `draw_shape` → horizontal_line, trend_line, rectangle, text (pass point + optional point2)
- `draw_list` / `draw_remove_one` / `draw_clear` → manage drawings

### "Manage alerts"
- `alert_create` / `alert_list` / `alert_delete`

### "Navigate the UI"
- `ui_open_panel` → open/close pine-editor, strategy-tester, watchlist, alerts, trading
- `ui_click` → click buttons by aria-label, text, or data-name
- `layout_switch` / `ui_fullscreen` / `capture_screenshot`

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

MCP server auto-captures CDP events (console, exceptions, browser log) to a ring buffer and writes JSONL session logs to `~/.tradingview-mcp/logs/diagnostics/`.

```bash
./scripts/launch_tv_observable.sh              # CDP + verbose Electron logs
./scripts/launch_tv_observable.sh --v=2        # extra verbose
TV_MCP_NETWORK=1 npm start                     # enable Network responses/failures
TV_MCP_NETWORK=1 TV_MCP_WS_FRAMES=1 npm start # also capture WebSocket frames
```

Interactive DevTools: open Chrome → `chrome://inspect` → Configure `localhost:9222` → Inspect the TradingView renderer tab.

## CDP Connection Pool (concurrency)

Tools lease a tab via `withTab(fn, { route })` (`src/core/withTab.js`); the pool (`src/core/CdpPool.js`) adopts the user's existing chart as the **primary** (slot 0) and grows throwaway **worker** tabs up to `TV_MCP_MAX_TABS`. At capacity, requests **queue** (never fail) until a tab frees.

**Routing intent:**

| Route | Meaning | Tools |
|-------|---------|-------|
| `visible` | primary/user-facing tab (slot 0); serializes user-visible ops | `chart_*`, `data_*`, `quote_get`, `draw_*`, `ui_*`, `pine_*`, `capture_screenshot`, `indicator_*`, `pane_*`, `watchlist_*`, `alert_*`, `market_status`, `symbol_info` |
| `headless` | any worker tab; grows on demand, queues at capacity | `chart_fetch_ohlcv`, `symbol_search*`, `batch_run`, `news_*`, `options_search` |
| replay lock | global exclusive lock + pinned visible tab via `ReplaySession` | `replay_*` |

Tool errors carry `{ code, retryable }` (see `src/core/TvError.js`): `POOL_EXHAUSTED`, `POOL_DRAINING`, `CHART_TIMEOUT` are retryable; `CDP_DOWN`, `TARGET_GONE`, `JS_EVAL`, `REPLAY_ACTIVE` are not.

**Pool env flags:**

| Var | Default | Effect |
|-----|---------|--------|
| `TV_MCP_MAX_TABS` | `5` | Max concurrent tabs incl. primary |
| `TV_MCP_TAB_TIMEOUT_MS` | `20000` | Queue timeout before `POOL_EXHAUSTED` |
| `TV_MCP_EVAL_TIMEOUT_MS` | `15000` | Per-op `evaluate()` timeout |
| `TV_MCP_DRAIN_TIMEOUT_MS` | `8000` | `drain()` deadline before force-closing leased tabs |
| `TV_MCP_REPLAY_EXPIRY_MS` | `600000` | Idle replay session auto-expiry (releases global lock) |
| `TV_MCP_STRICT_DI` | _(unset)_ | `=1` → throws on missing `_deps` (CI/DI gate) |
| `TV_MCP_POOL` | _(unset)_ | `=0` → bypass pool, use legacy `getClient()` singleton |
| `TV_MCP_WORKER_TTL_MS` | `300000` | Idle-worker tab TTL in ms (`=0` disables TTL eviction) |
| `TV_MCP_FRESH_TIMEOUT_MS` | `8000` | `chart_fetch_ohlcv` bar-freshness gate timeout |
| `TV_MCP_STRICT_FRESH` | _(unset)_ | `=1` → throw `CHART_TIMEOUT` on stale bars instead of warning |

**Symbol affinity:** headless acquire prefers a worker tab already loaded on the requested symbol to avoid redundant reloads. `conn.symbol` is updated lazily post-success via `setSymbolHint` (failed switches never poison the tab's recorded symbol).

## REST-First Architecture

**Doctrine:** prefer direct REST endpoints over GUI/DOM manipulation wherever a stable endpoint exists. Two execution modes in `src/core/_rest.js`:
- `restFromRenderer(evaluateAsync, url)` — authenticated endpoints from the logged-in renderer (carries session cookie)
- `restFromNode(fetch, url)` — public unauthenticated endpoints from Node

**DI pattern** (all REST-migrated core functions):
```js
export async function listScripts({ _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  assertRestEnabled('pine_list_scripts');
  const data = await restFromRenderer(evaluateAsync, url);
}
```
Tests inject mock `evaluateAsync` via `_deps`. `TV_MCP_STRICT_DI=1` throws if `_deps` is missing (CI gate).
Set `TV_MCP_REST=0` to force CDP fallback paths; tools without a fallback throw `TvError('REST_DISABLED')`.

**Source field:** all REST returns include `source` for caller transparency:
- `"rest_api"` — data came from a TradingView REST endpoint
- `"cdp"` — data came from a CDP `evaluate()` expression
- `"searchSymbols"` — renderer searchSymbols API (tier-2 fallback for symbol_search)

**Error codes:** `TvError('REST_HTTP')` — retryable for 429/5xx, non-retryable for 4xx. `TvError('REST_DISABLED')` — non-retryable, only when `TV_MCP_REST=0` and the tool has no CDP fallback.

# 3-Phase Observable Testing Plan — TradingView MCP

> Status: **Approved** (repeat loop, 4 iterations, adversarial critic). macOS only.
> Date: 2026-06-27

## Context grounding (verified against the codebase)

- **macOS only.** This plan targets macOS exclusively (same scope as the existing `launch_tv_debug_mac.sh`).
- **ESM module**: `package.json` has `"type": "module"`. All new files use `export`/`import`. Never use `module.exports`.
- **CDP layer** (`src/connection.js`): singleton `client` from `chrome-remote-interface`. `connect()` enables Runtime, Page, DOM (lines 76-78). No event listeners exist today. `evaluate()`/`evaluateAsync()` are the only egress.
- **DI/mock convention** (`src/core/chart.js:9-15`): `_resolve(deps)` returns `{ evaluate, evaluateAsync, waitForChartReady }`, overridable via `_deps`. Tests inject `mockEvaluate` recording `.calls`.
- **Observability gaps confirmed**: `pine.getConsole()` (`src/core/pine.js:379`) DOM-scrapes `[class*="consoleRow"]`; `src/core/stream.js` is poll-and-diff (300-2000ms). No CDP event subscriptions exist.
- **CLAUDE.md already documents** max-logging flags (lines 168-219) and `chrome://inspect`. New docs extend that section.
- **Existing launch scripts**: `scripts/launch_tv_debug_mac.sh` (macOS), `_linux.sh`, `.bat`, `.vbs`.
- **Actual src/tools/ files (15 modules)**: `_format.js, alerts.js, batch.js, capture.js, chart.js, data.js, drawing.js, health.js, indicators.js, pane.js, pine.js, replay.js, tab.js, ui.js, watchlist.js`

---

## Phase 1: Observable Testing Environment

### 1.1 Verbose launch flag set

Default observable launch flags:
```
ELECTRON_ENABLE_LOGGING=1
--remote-debugging-port=9222
--enable-logging=stderr
--v=1
--vmodule=*/net/*=1,*/url/*=1
```

DevTools auto-open: **OFF by default**. Passthrough flags to the script: `--devtools` (adds `--auto-open-devtools-for-tabs`), `--v=2` (increases Chromium verbosity).

**Env feature flags** (default OFF; must be set before server start):
- `TV_MCP_NETWORK=1` — enables `Network` CDP domain; subscribes to `responseReceived` + `loadingFailed` for chart/datafeed URLs
- `TV_MCP_WS_FRAMES=1` — additionally subscribes to `webSocketFrameReceived` (requires `TV_MCP_NETWORK=1`)

### 1.2 `scripts/launch_tv_observable.sh` (NEW — macOS only)

Modeled on `scripts/launch_tv_debug_mac.sh`. Reuses its `LOCATIONS` array and `mdfind` fallback verbatim for app discovery. Additions:
- Sets `ELECTRON_ENABLE_LOGGING=1` and the §1.1 flag set
- Accepts `--v=2` and `--devtools` passthroughs
- Tees Chromium stderr to `~/.tradingview-mcp/logs/native/tv_native_$(date +%Y%m%d_%H%M%S).log` via `tee`
- After CDP ready (reuses `curl .../json/version` poll loop from `launch_tv_debug_mac.sh`), prints the `devtools://devtools/bundled/inspector.html?ws=localhost:9222/devtools/page/<ID>` URL by calling `curl -s http://localhost:9222/json/list | python3 -c "import sys,json; t=json.load(sys.stdin); print(t[0].get('devtoolsFrontendUrl',''))"`

### 1.3 `src/connection.js` (MODIFY)

Add at module level (ESM, after existing imports):
```js
let _diagnosticsSink = null;

export function setDiagnosticsSink(fn) {
  _diagnosticsSink = fn;
  // If already connected, attach immediately (e.g. called after first connect)
  if (client && fn) fn(client);
}
```

In `connect()`, after the existing `await client.Runtime.enable()` / `Page.enable()` / `DOM.enable()` block, add:
```js
async function enableSafe(client, domain) {
  if (!client[domain]) return;        // guard: domain may not exist on all targets
  try { await client[domain].enable(); } catch (_) {}
}

await enableSafe(client, 'Log');
if (process.env.TV_MCP_NETWORK === '1') {
  await enableSafe(client, 'Network');
}

// Re-attach diagnostics sink on EVERY connect() call — this is reconnect-safe.
// getClient() nulls + reconnects on a dead client (connection.js:50-61),
// so calling _diagnosticsSink(client) here ensures listeners survive reconnects.
if (_diagnosticsSink) _diagnosticsSink(client);
```

### 1.4 `src/core/diagnostics.js` (NEW)

**Session file and symlink handshake:**
- `startDiagnostics()` creates `~/.tradingview-mcp/logs/diagnostics/session_<ISO8601>.jsonl` (ISO 8601 timestamp in filename is valid on macOS)
- Writes first line: `{"type":"session_start","ts":<epoch_ms>}` (the `since` anchor for test assertions)
- Creates/updates `~/.tradingview-mcp/logs/diagnostics/current` symlink pointing to the active session filename
- CLI `--follow` resolves `current` symlink; test helpers read `session_start` ts for time-bounded assertions

**`startDiagnostics(deps?)` exported function:**
Called once in `src/server.js` bootstrap (§1.6). Calls `setDiagnosticsSink(attachListeners)`. Does NOT force a connection — the sink attaches when `connect()` is first called by `getClient()`, and re-attaches on every reconnect automatically (see §1.3).

**Reconnect contract and idempotency:**
Each call to `attachListeners(client)` binds a fresh set of listeners to the NEW client instance passed in. It does NOT accumulate stale listeners — each reconnect yields a fresh CRI client object, so calling `attachListeners(newClient)` is inherently idempotent (no removal of old listeners needed; the old client is discarded). The `_diagnosticsSink` reference is set once; `connect()` calls `_diagnosticsSink(client)` on EVERY connect call (including reconnects), always passing the fresh client. Diagnostics therefore survive every CDP drop+reconnect automatically.

**Exact CRI event subscription form** (domains must be enabled before subscribing):
```js
function attachListeners(client) {
  // Default subscriptions (always active):
  client.Runtime.on('consoleAPICalled', (evt) => sink({
    type: 'console', level: evt.type,
    text: (evt.args || []).map(a => a.value ?? a.description ?? '').join(' '),
    ts: Date.now()
  }));
  client.Runtime.on('exceptionThrown', (evt) => sink({
    type: 'exception', text: evt.exceptionDetails?.text,
    stack: evt.exceptionDetails?.stackTrace, ts: Date.now()
  }));
  client.Log.on('entryAdded', (evt) => sink({
    type: 'log', level: evt.entry.level, text: evt.entry.text,
    source: evt.entry.source, url: evt.entry.url, ts: Date.now()
  }));

  // Opt-in via TV_MCP_NETWORK=1:
  if (process.env.TV_MCP_NETWORK === '1') {
    const urlFilter = (url) => /chart|datafeed|symbol|tv-tickers/.test(url ?? '');
    client.Network.on('responseReceived', (evt) => {
      if (!urlFilter(evt.response?.url)) return;
      sink({ type: 'network_response', url: evt.response.url,
             status: evt.response.status, ts: Date.now() });
    });
    client.Network.on('loadingFailed', (evt) => {
      if (!urlFilter(evt.documentURL)) return;
      sink({ type: 'network_failed', url: evt.documentURL,
             error: evt.errorText, ts: Date.now() });
    });

    // Opt-in via TV_MCP_WS_FRAMES=1 (requires TV_MCP_NETWORK=1):
    if (process.env.TV_MCP_WS_FRAMES === '1') {
      client.Network.on('webSocketFrameReceived', (evt) => sink({
        type: 'ws_frame', requestId: evt.requestId,
        payload: evt.response?.payloadData, ts: Date.now()
      }));
    }
  }
}
```

**Ring buffer:** 10,000 events max in memory; oldest evicted on overflow. The ring buffer is the ordering source of truth; the JSONL is best-effort.

**JSONL append:** `fs.promises.appendFile(...).catch(() => {})` — async fire-and-forget. Never blocks the CDP event handler's event loop. Note: under bursts, concurrent async appends may interleave; rely on per-event `ts` for ordering when reading the JSONL. The `{ appendLine }` DI seam defaults to this async form; tests inject a sync or mock version.

**Concurrent read safety:** `getDiagnostics()` uses `fs.readFileSync()`, splits on `\n`, skips (try/catch `JSON.parse`) any unparseable line — tolerates a partial trailing line from a concurrent write.

**DI seam:** `startDiagnostics({ appendLine, now } = {})` where defaults are the async `fs.promises.appendFile` fire-and-forget and `Date.now`.

**Exported API:**
```js
export function startDiagnostics(deps)
export function getDiagnostics({ type, since, limit })
export function clearDiagnostics()
```

### 1.5 `src/cli/commands/diagnostics.js` (NEW)

Registers with `src/cli/router.js` using the exact `short:` key syntax:
```js
register('diagnostics', {
  description: 'Read or tail CDP diagnostics (console, exceptions, network, logs)',
  options: {
    type:   { type: 'string' },
    since:  { type: 'string' },
    limit:  { type: 'string', short: 'n' },
    follow: { type: 'boolean', short: 'f' },
    clear:  { type: 'boolean' },
  },
  handler: async (opts) => { /* call getDiagnostics or clearDiagnostics */ }
});
register('logs', { description: 'Alias for tv diagnostics', options: {}, handler: same });
```

`--follow` resolves `~/.tradingview-mcp/logs/diagnostics/current` symlink (errors with helpful message if not found: "No active session — is the MCP server running?"), then tails the target JSONL file.

### 1.6 `src/server.js` (MODIFY)

```js
import { startDiagnostics } from './core/diagnostics.js';
// ... existing server setup, tool registrations, transport bind ...
startDiagnostics();
```

`startDiagnostics()` registers the sink via `setDiagnosticsSink()` but does NOT force a connection. The sink attaches on the first `connect()` call (triggered lazily by `getClient()`) and re-attaches automatically on every reconnect.

### 1.7 CLAUDE.md additions

Append to the existing "Debugging & Observability" section (after line 219):
```markdown
### Structured diagnostics (via CDP events)

Run the server via `./scripts/launch_tv_observable.sh` to get verbose Electron + Chromium logs
teed to `~/.tradingview-mcp/logs/native/`.

CDP events (console, exceptions, browser log) are automatically captured to
`~/.tradingview-mcp/logs/diagnostics/` when the MCP server is running.

Query the live buffer:
  tv diagnostics -f                  # tail the active session (resolve 'current' symlink)
  tv diagnostics --type exception    # exceptions only
  tv diagnostics --since <epoch_ms>  # events after a timestamp
  tv logs                            # alias for tv diagnostics

Opt-in env flags (set before starting the server):
  TV_MCP_NETWORK=1          enables Network responses/failures for chart/datafeed URLs
  TV_MCP_WS_FRAMES=1        additionally captures WebSocket frames (requires NETWORK=1)
```

---

## Phase 2: Thorough Testing of All Current MCP Tools

### 2.1 Tool inventory (actual src/tools/ files)

| Module | MCP tool names |
|---|---|
| `alerts.js` | `alert_create`, `alert_list`, `alert_delete` |
| `batch.js` | `batch_run` |
| `capture.js` | `capture_screenshot` |
| `chart.js` | `chart_get_state`, `chart_set_symbol`, `chart_set_timeframe`, `chart_set_type`, `chart_manage_indicator`, `chart_get_visible_range`, `chart_set_visible_range`, `chart_scroll_to_date`, `symbol_info`, `symbol_search` |
| `data.js` | `data_get_ohlcv`, `data_get_indicator`, `data_get_strategy_results`, `data_get_trades`, `data_get_equity`, `quote_get`, `depth_get`, `data_get_pine_lines`, `data_get_pine_labels`, `data_get_pine_tables`, `data_get_pine_boxes`, `data_get_study_values` |
| `drawing.js` | `draw_shape`, `draw_list`, `draw_clear`, `draw_remove_one`, `draw_get_properties` |
| `health.js` | `tv_health_check`, `tv_discover`, `tv_ui_state`, `tv_launch` |
| `indicators.js` | `indicator_set_inputs`, `indicator_toggle_visibility` |
| `pane.js` | `pane_list`, `pane_set_layout`, `pane_focus`, `pane_set_symbol` |
| `pine.js` | `pine_get_source`, `pine_set_source`, `pine_compile`, `pine_get_errors`, `pine_save`, `pine_get_console`, `pine_smart_compile`, `pine_new`, `pine_open`, `pine_list_scripts`, `pine_analyze`, `pine_check` |
| `replay.js` | `replay_start`, `replay_step`, `replay_autoplay`, `replay_stop`, `replay_trade`, `replay_status` |
| `tab.js` | `tab_list`, `tab_new`, `tab_close`, `tab_switch` |
| `ui.js` | `ui_click`, `ui_open_panel`, `ui_fullscreen`, `layout_list`, `layout_switch`, `ui_keyboard`, `ui_type_text`, `ui_hover`, `ui_scroll`, `ui_mouse_click`, `ui_find_element`, `ui_evaluate` |
| `watchlist.js` | `watchlist_get`, `watchlist_add` |

(`_format.js` is a shared formatting utility, not a tool-registration file. Note: tool-count strings drift across `server.js`/CLAUDE.md/this plan — reconcile in a cleanup pass.)

### 2.2 Test matrix and destructive cleanup strategies

**Cleanup categories:**

- **Read-only / no cleanup**: `tv_health_check`, `tv_discover`, `tv_ui_state`, `chart_get_state`, `chart_get_visible_range`, `symbol_info`, all `data_*` reads, `quote_get`, `depth_get`, `pane_list`, `tab_list`, `alert_list`, `watchlist_get`, `pine_get_source`, `pine_get_errors`, `pine_get_console`, `pine_list_scripts`, `pine_analyze`, `pine_check`, `replay_status`, `ui_find_element`, `ui_evaluate`, `layout_list`, `capture_screenshot`

- **Restore-on-cleanup (snapshot before → restore in finally/after())**: `chart_set_symbol/timeframe/type` (save → restore), `chart_manage_indicator (add)` (save study IDs → remove new ones), `chart_set_visible_range`/`chart_scroll_to_date` (save range → restore), `pine_set_source`/`pine_compile`/`pine_smart_compile`/`pine_save`/`pine_new`/`pine_open` (save source/script → restore), `indicator_set_inputs`/`indicator_toggle_visibility` (save/toggle back), `pane_set_layout`/`pane_focus`/`pane_set_symbol` (save → restore), `ui_open_panel`/`ui_fullscreen`/`layout_switch` (toggle/switch back), `replay_start`+`replay_stop` (always stop in after()), `alert_create`+`alert_delete` (snapshot alert IDs before; delete only NEW IDs after — never blanket delete), `tab_new`+`tab_close` (close only newly opened tab by ID diff), `tab_switch` (save original tab index → switch back)

- **Sequence-dependent pairs**: `draw_shape → draw_list → draw_get_properties → draw_remove_one → draw_clear`; `replay_start → replay_step → replay_autoplay → replay_trade → replay_stop`

**Watchlist prerequisite and scope gate:**
`watchlist_remove` does NOT exist today and CANNOT be implemented as a simple inversion of `watchlist_add` (add() is DOM+CDP-Input scraping with no API to invert). It requires a fresh DOM-interaction strategy: right-click the symbol row → "Remove from Watchlist", OR a hover-delete button. **Scope gate:** watchlist destructive tests (`watchlist_add` → `watchlist_remove`) are EXCLUDED from Phase 2 scope until `watchlist_remove` is implemented and unblocked. Skip with `test.skip`. Phase 2 runs WITHOUT them.

**`tv_launch` excluded from live testing** — it kills/relaunches TradingView, destroying the CDP session. Covered by a path-detection-only test that verifies the binary exists without invoking `core.launch()`.

**Context size assertions** (dedicated describe block): `quote_get` < 500 B; `data_get_study_values` < 2 KB; `data_get_pine_lines` < 4 KB/study; `data_get_pine_labels` < 8 KB/study; `data_get_ohlcv (summary)` < 1 KB; `capture_screenshot` response < 500 B.

### 2.3 Execution order

`--test-concurrency=1` (CDP singleton + shared chart make parallelism unsafe). Describe blocks in dependency order:

1. Health & Connection → 2. Chart Control → 3. Data Access → 4. Pine Script → 5. Drawing → 6. UI Automation → 7. Replay Mode → 8. Alerts → 9. Watchlist (read-only; `watchlist_add` `test.skip`) → 10. Indicators → 11. Pane → 12. Tab → 13. Batch (symbol-switch only) → 14. Capture → 15. Context Size Validation

**Exception correlation** — after each describe:
```js
const since = readSessionStartTs();  // reads ts from session_start marker via current symlink
const exceptions = getDiagnostics({ type: 'exception', since });
assert(exceptions.length === 0);
```

### 2.4 Fix workflow (critic checklist)

For each defect found:
- [ ] Root cause traced to `src/core/*.js` (not tool wrapper)
- [ ] Fix preserves `_resolve(_deps)` DI seam
- [ ] Any newly interpolated user value goes through `safeString()`/`requireFinite()`
- [ ] No new CDP domains enabled outside `connection.js`
- [ ] After fix: diagnostics show zero new `exception` records for that tool
- [ ] No regression on existing e2e happy path
- [ ] Run `/critic` on diff for non-trivial logic changes
- [ ] Add DI-mock unit test following `tests/replay.test.js` pattern
- [ ] Commit: one category per commit, `fix(core/<module>): <root cause>` + unit test

Failure triage: stale selector → update CSS selector in core; API path drift → probe via `tv evaluate`, update `KNOWN_PATHS`; timing → adjust `sleep()`; env-dependent → add skip guard.

### 2.5 Run loop

```bash
# Terminal A — launch TV with verbose logging + parallel CDP event capture
./scripts/launch_tv_observable.sh
# Terminal B — live tail
tv diagnostics -f

# Full suite (sequential)
node --test --test-concurrency=1 tests/e2e.test.js
# Single describe block
node --test --test-name-pattern="Drawing" tests/e2e.test.js
# Offline-only
node --test --test-name-pattern="pine_analyze|pine_check|Context Size" tests/e2e.test.js

# Inspect exceptions for a run
tv diagnostics --type exception --since <session_start_ts>
# fix src/core/<module>.js → add DI unit test → npm run test:unit green → commit when user confirms
```

---

## Phase 3: Hidden Capabilities Discovery

### 3.1 Runtime enumeration via evaluate()

`scripts/probe_api.js` (standalone ESM Node script, connects to CDP directly like `e2e.test.js`'s `before()`) walks known TradingView API roots:
- `window.TradingViewApi`
- `window.TradingViewApi._activeChartWidgetWV.value()` (chart widget)
- `...value()._chartWidget.model()` (panes, series, timescale)
- `window.TradingViewApi._chartWidgetCollection`
- `window.ChartApiInstance` (if defined)
- `window.TradingViewApi._alertService`

Enumeration expression (read-only): for each key emit `{ type: typeof, arity: fn.length }`; diff against methods already wired in `src/core/*.js` (grep) to isolate unused capabilities. Output JSONL to `~/.tradingview-mcp/logs/probe/probe_<timestamp>.jsonl`.

### 3.2 Six categories to probe

1. **Drawing/shapes** — `createShape`, `createMultipointShape`, templates beyond current 4 (fib, gann, measure, positions)
2. **Strategy deep metrics** — `performance()`, `ordersData()`, `reportData()`, per-trade MAE/MFE
3. **Alerts extended** — firing history, snooze, condition templates
4. **Watchlist extended** — reorder, sections, colors, import/export, **remove** (unblocks §2.2)
5. **UI/layout** — `getSavedCharts`, `loadChartFromServer`, layout templates, theme switching
6. **Datafeed / event-driven** — `ChartApiInstance` quote/history subscription handles; prototype `stream_ohlcv` backed by `webSocketFrameReceived` as an alternative to `stream.js` poll-and-diff (exploratory; blocked on frame-format reverse engineering, which the diagnostics buffer + probe enable)

### 3.3 Scoring rubric per candidate

`Feasibility × 2 + Value × 2 + Effort × 1` = max 25.
- **Feasibility** (1-5): 5 = documented charting-library method; 3 = stable internal path used elsewhere in repo; 1 = deeply private `_`-prefixed path. **Reject if Feasibility = 1.**
- **Value** (1-5): 5 = repeatedly needed (event-driven streaming, strategy metrics); 1 = cosmetic.
- **Effort (inverse)** (1-5): 5 = <30 lines, one evaluate, existing DI pattern; 1 = new modal handling or cloud-state writes.

### 3.4 Top-5 output format

Per candidate: API path + probe evidence (typeof + arity); category + proposed MCP tool name + one-line description; scores (F/V/E) + weighted total; implementation sketch (src/core file, expression shape, safeString needs, DI seam, unit test outline); risks (stability, cloud mutation, async/modal hazards). Delivered as ranked table + per-candidate detail blocks. No tools implemented in Phase 3 — this feeds the backlog for user review.

---

## Implementation Order

1. `src/connection.js` — add `setDiagnosticsSink` + `enableSafe` + reconnect-safe attach
2. `src/core/diagnostics.js` — ring buffer, async JSONL writer, `current` symlink, `session_start` marker
3. `tests/diagnostics.test.js` — DI-mock unit test (sync appendLine mock, ring-buffer eviction, session_start written, `getDiagnostics({type,since})` filtering)
4. `src/server.js` — `import { startDiagnostics }` + call `startDiagnostics()`
5. `src/cli/commands/diagnostics.js` — register `diagnostics` + `logs`; also add `import './commands/diagnostics.js';` to `src/cli/index.js` (explicit imports, not auto-discovery — verified at lines 13-27)
6. `scripts/launch_tv_observable.sh` — macOS launch with tee logging + DevTools URL printer
7. `CLAUDE.md` — append structured diagnostics section after line 219
8. `watchlist_remove` (blocked on DOM exploration)
9. Offline DI-mock tests (diagnostics covered in step 3; chart/data/drawing/pane/indicators expression shapes)
10. Live e2e suite — expand `tests/e2e.test.js` to cover pane (4), tab (4), Context Size blocks; `watchlist_add` marked `test.skip`
11. `scripts/probe_api.js` — Phase 3 capability enumeration

## Artifacts

| Artifact | Action | Phase |
|---|---|---|
| `src/connection.js` | MODIFY | 1 |
| `src/core/diagnostics.js` | NEW | 1 |
| `src/server.js` | MODIFY | 1 |
| `src/cli/commands/diagnostics.js` | NEW | 1 |
| `src/cli/index.js` | MODIFY (1 import line) | 1 |
| `scripts/launch_tv_observable.sh` | NEW (macOS only) | 1 |
| `CLAUDE.md` | MODIFY | 1 |
| `tests/diagnostics.test.js` | NEW | 1 |
| `src/tools/watchlist.js` | MODIFY — add `watchlist_remove` (blocked on DOM exploration) | 2 prereq |
| `tests/e2e.test.js` | EXPAND | 2 |
| `scripts/probe_api.js` | NEW | 3 |

### Critical Files for Implementation
- `/Users/heraroma/projects/tradingview-mcp/src/connection.js`
- `/Users/heraroma/projects/tradingview-mcp/src/core/diagnostics.js`
- `/Users/heraroma/projects/tradingview-mcp/src/cli/index.js`
- `/Users/heraroma/projects/tradingview-mcp/src/server.js`
- `/Users/heraroma/projects/tradingview-mcp/tests/e2e.test.js`

---

## Open follow-ups (cosmetic, non-blocking)
- Reconcile tool-count strings across `server.js` (78), `CLAUDE.md` (68), this plan (70).
- JSONL line ordering under event bursts is best-effort; rely on per-event `ts` when reading.

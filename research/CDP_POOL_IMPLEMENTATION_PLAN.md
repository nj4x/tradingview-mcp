# CDP Connection Pool — Implementation Plan

## Overview

Replace the single CDP singleton in `src/connection.js` with a bounded pool of per-tab connections.

**Routing intent model:**
- `route: 'visible'` — user's primary chart tab
- `route: 'headless'` — worker tabs (batch, search, news)
- `route: {tabId}` — replay pin (exclusive lock on a specific tab)

**Full design document:** `/Users/heraroma/projects/tradingview-mcp/docs/design/cdp-pool.md` (1480 lines, iteration 4, 20-critic approved)

---

## New Files (8 modules)

| File | Responsibility |
|------|---------------|
| `src/core/TvError.js` | Typed errors: `POOL_EXHAUSTED`, `POOL_DRAINING`, `CHART_TIMEOUT`, `CDP_DOWN`, `TARGET_GONE`, `JS_EVAL`, `REPLAY_ACTIVE` + `retryable` flag |
| `src/core/_safe.js` | `safeString`, `requireFinite`, `safeRegex` — extracted from `connection.js` |
| `src/core/_resolve.js` | `makeResolver(names)`: Stage A warns + singleton fallback; Stage B throws when `TV_MCP_STRICT_DI=1` |
| `src/core/CdpConnection.js` | Per-tab: `'disconnect'` event, per-op 15 s timeout via `Promise.race`, bounded serial queue |
| `src/core/cdpDiscovery.js` | `createNewTarget` (`PUT` → `Cmd+T` fallback), `listChartTargets`, `attach`, `closeTarget`; `_createdTargetIds` tracking; uses real `waitForChartReady` from `wait.js` |
| `src/core/CdpPool.js` | Full pool with all concurrency fixes (see section below) |
| `src/core/replaySession.js` | Global exclusive lock (`_replayLock`), auto-expiry 10 min |
| `src/core/withTab.js` | `withTab(fn, {route, connection})`; `TV_MCP_POOL=0` bypass to `getLegacyDeps()` |

---

## Edited Files

| File | Change |
|------|--------|
| `src/connection.js` | Re-export `safeString`/`requireFinite` from `_safe.js`; add `getPool()`, `getReplaySession()`, `ensurePrimarySlot()`, `getLegacyDeps()`, `resetPool()` |
| `src/wait.js` | Accept optional `_deps ({evaluate})` as 4th arg for testability |
| `src/core/*.js` (18 modules) | Thread `_deps` via `makeResolver` — 7 existing-DI + 10 net-new |
| `src/tools/*.js` | Wrap in `withTab({route})`; surface `{code, retryable}` from `TvError` |
| `src/server.js` | Call `ensurePrimarySlot()` on startup; `drain()` on `SIGINT`/`SIGTERM` |

---

## Critical Concurrency Fixes (all implemented in `CdpPool.js`)

| ID | Fix |
|----|-----|
| I-1 | `_pendingCount` wraps ALL creation paths (including `ensurePrimary` via `_doEnsurePrimary`) |
| I-2 | `_maybeGrowForWaiters()` called on idle-death AND dead-release (tab dies → re-grow for waiters) |
| I-3 | `_failPendingSlot` uses `findIndex(w => !w.wantId)` — only rejects first untargeted waiter |
| I-4 | `_replayLock` global exclusive lock replaces illusory per-tab replay affinity |
| I-5 | `_acquirePinned` fast-fails `TARGET_GONE` for dead/gone tabs |
| I-6 | `drain(deadlineMs=8000)` polls 50 ms, force-closes after deadline, always resolves; flushes `_replayLock.waiters` |
| I-7 | `replay_run` passes held connection via `withTab(fn, {connection})` bypass |
| M-2 | `_primaryInitPromise` one-shot guard prevents concurrent `ensurePrimary` double-fire |
| M-5 | `CdpConnection.run()` per-op `Promise.race` timeout; chain resets to resolved when depth=0 |

---

## PHASE 0 — DI Prerequisite (6 steps, sequential)

| Step | Action | Gate |
|------|--------|------|
| **0a** | Create `src/core/_safe.js`. Extract `safeString`/`requireFinite`/`safeRegex` from `connection.js`. Re-export both from `connection.js` for backwards compat. | `sanitization.test.js` green |
| **0b** | Create `src/core/_resolve.js` with `makeResolver(names)`. Stage A: warn + singleton fallback. Stage B (`TV_MCP_STRICT_DI=1`): throw. | Unit test: warn once per name; strict throws |
| **0c** | Thread `_deps` through **7 existing-DI** modules using `makeResolver`: `chart` (incl. `getVisibleRange`/`symbolInfo`/`symbolSearch`), `data`, `drawing`, `news`, `options`, `pine`, `replay` | Existing unit tests pass |
| **0d** | Thread `_deps` through **10 net-new** modules: `alerts`, `batch`, `capture`, `health`, `indicators`, `pane`, `stream`, `tab`, `ui`, `watchlist`. Also add optional `_deps` 4th arg to `wait.js` `waitForChartReady`. | Every core fn accepts `_deps` |
| **0e** | Add lint rule: `tests/no-singleton-import.test.js` — fails if any `src/core/*.js` imports `evaluate`/`getClient` from `connection.js` | Lint passes |
| **0f** | Run full suite under `TV_MCP_STRICT_DI=1`. Fix any remaining leaks. | `TV_MCP_STRICT_DI=1 npm run test:unit` green |

> **Note:** `diagnostics.js` uses `_deps` for a sink (not `evaluate`) — no `makeResolver` needed. `index.js`/`utils.js` have no `evaluate` calls — excluded. Total: 7 + 10 = 17 modules threaded.

---

## PHASE 1 — Pool Implementation (12 steps)

| # | Step | Depends on | Can parallelize with |
|---|------|-----------|---------------------|
| 1 | Create `TvError.js` | — | 2, 3 |
| 2 | Create `CdpConnection.js` | 1 (TvError) | 3 |
| 3 | Create `cdpDiscovery.js` | 1 (TvError) | 2 |
| 4 | Create `CdpPool.js` | 2, 3 | — |
| 5 | Create `withTab.js` | 4 | 6 |
| 6 | Wire `connection.js` (`getPool`, `getReplaySession`, etc.) | 4 | 5 |
| 7 | Create `replaySession.js` | 5, 6 | 8, 9 |
| 8 | Migrate read tools (`withTab` headless/visible) | PHASE 0, 5 | 9 |
| 9 | Migrate write + replay tools | PHASE 0, 5, 7 | 8 |
| 10 | Startup (`server.js` `ensurePrimarySlot` + `drain` on signal) | 6, 7, 8, 9 | — |
| 11 | Kill-switch test (`TV_MCP_POOL=0` e2e smoke) | 10 | — |
| 12 | Docs (`CLAUDE.md` env table + routing section) | 11 | — |

---

## Test Files (all offline, node:test)

- **`tests/pool.test.js`** — T-NEW-1…T-NEW-12 + pool internals + T-CDP3-retry + T-STRICT-DI + T-NEW-1b (15+ tests total)
- All fake discovery (mocked `createNewTarget`/`attach`/`listChartTargets`/`closeTarget`)
- Fake timers via `node:test` mock timers for timeout/drain/expiry tests

---

## Route Assignment

| Route | Tools |
|-------|-------|
| `visible` | `chart_set_*`, `chart_scroll_to_date`, `chart_set_visible_range`, `chart_manage_indicator`, `draw_*`, `ui_*`, `capture_screenshot`, `layout_switch`, `alert_*`, `quote_get`, `data_get_*` (user-facing reads) |
| `headless` | `chart_fetch_ohlcv` fan-out, `batch_run` per-symbol legs, `symbol_search*`, `news_*`, non-user-facing reads |
| replay lock | `replay_*` (via `ReplaySession` which holds global lock + tab pin) |

---

## Environment Variables

| Var | Default | Purpose |
|-----|---------|---------|
| `TV_MCP_MAX_TABS` | `3` | Max tabs including primary |
| `TV_MCP_TAB_TIMEOUT_MS` | `20000` | `acquire()` timeout → `POOL_EXHAUSTED` |
| `TV_MCP_EVAL_TIMEOUT_MS` | `15000` | Per-op `evaluate()` timeout → `CHART_TIMEOUT` |
| `TV_MCP_DRAIN_TIMEOUT_MS` | `8000` | `drain()` deadline before force-close |
| `TV_MCP_REPLAY_EXPIRY_MS` | `600000` | Idle replay session auto-expiry (10 min) |
| `TV_MCP_STRICT_DI` | (unset) | `=1` → `makeResolver` throws on missing `_deps` |
| `TV_MCP_POOL` | (unset) | `=0` → bypass pool; use legacy `getClient()` singleton |

---

## Kill Switch

`TV_MCP_POOL=0` bypasses the pool entirely. Singleton code is retained in `connection.js` for one release.

---

## Backwards Compatibility

- CLI unaffected — uses `getClient()` directly, no pool
- Existing offline tests (`sanitization`, `pine_analyze`, `cli`) stay green throughout
- Re-exports in `connection.js` preserve all existing import patterns during transition

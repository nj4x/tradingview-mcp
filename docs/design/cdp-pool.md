# CDP Connection Pool — Implementation Design

**Status:** Revised (iteration 3)
**Scope:** Add multi-tab concurrency to tradingview-mcp by replacing the single CDP
connection singleton (`src/connection.js`) with a bounded pool of per-tab CDP
connections, fronted by a `withTab()` lease helper and an intent-based routing model.

This revision fixes every concurrency, architecture, CDP/Electron, operational and
test-coverage issue identified in the prior design review (I-1…I-7, M-5, ARCH-1/2,
CDP-1/2/3, OPS-1/2/3/4, T-NEW-1…T-NEW-12).

---

## 1. Overview

### 1.1 The problem

Today every MCP tool call funnels through one CDP client bound to one TradingView
chart target (`src/connection.js` → `client`). Two simultaneous tool calls serialize:
the second `evaluate()` waits for the first to release the renderer. Fan-out tools
(`batch_run`, `analyzeChart`, `fetchOhlcv` across many symbols) cannot parallelize at
all because they would clobber each other's chart state on the single tab.

### 1.2 The routing intent model (ARCH-1)

The prior design routed on a `preferPrimary` vs "any tab" boolean — a read/write axis.
That is the **wrong axis**. The correct axis is *intent*, expressed as a `route`:

| `route` value      | Meaning                                                                                   | Examples |
|--------------------|-------------------------------------------------------------------------------------------|----------|
| `'visible'`        | Must run on the user's **active** chart (slot 0 / adopted primary). User sees the effect. | `chart_set_symbol`, `chart_set_timeframe`, `chart_set_type`, `draw_*`, interactive reads the user is watching |
| `'headless'`       | Runs on **any worker tab**. State mutations here are invisible to the user.                | `batch_run` fan-out, `chart_fetch_ohlcv` fan-out, screening |
| `{ tabId }`        | **Pinned** to one exact tab for an exclusive multi-call session.                          | replay (holds one tab across `replay_*` calls) |

Tools declare intent; the pool owns placement. Three placement strategies map 1:1 to
the three route kinds (see §7.4).

### 1.3 Three-layer architecture

```
                         ┌─────────────────────────────────────────┐
  MCP tool wrapper  ───► │  withTab(fn, { route })                  │  (§9)
  (src/tools/*.js)       │   - TV_MCP_POOL=0 → legacy getClient()   │
                         │   - else acquire → run fn(conn) → release│
                         └──────────────────┬──────────────────────┘
                                            │
                         ┌──────────────────▼──────────────────────┐
   Pool (singleton)      │  CdpPool (§7)                            │
                         │   acquire(route) / release(conn)         │
                         │   _idle / _used / _waiters / _pendingCnt │
                         │   _replayLock  _createdTargetIds          │
                         │   ensurePrimary() drain(deadlineMs)       │
                         └───────┬───────────────────────┬──────────┘
                                 │ creates               │ closes self-made
                ┌────────────────▼─────────┐    ┌────────▼──────────────┐
   Discovery    │ cdpDiscovery (§6)        │    │ DELETE /json/close/id │
                │  createNewTarget()       │    │  (OPS-2)              │
                │  PUT /json/new → Cmd+T   │    └──────────────────────┘
                │  waitForChartReady(conn) │
                └────────────┬─────────────┘
                             │ wraps
                ┌────────────▼─────────────┐
   Connection   │ CdpConnection (§5)       │
                │  per-tab serial queue    │
                │  per-op timeout (M-5)    │
                │  'disconnect' event       │
                │  evaluate / evaluateAsync│
                └──────────────────────────┘
```

`src/core/*.js` is untouched in spirit: each core fn still takes `_deps` with
`evaluate`/`evaluateAsync`. The only change is that `withTab` injects the **leased
connection's** bound `evaluate` into `_deps` instead of the module-global one.

### 1.4 Backwards-compat & kill switch (OPS-3)

- `TV_MCP_POOL=0` bypasses the pool entirely and uses the legacy `getClient()`
  singleton path. The pool is never instantiated. This is the rollback lever.
- The singleton code in `src/connection.js` is **retained in-tree** for one release
  after cutover, so reverting is a one-line env flag, not a code revert.
- The CLI front-end (`src/cli/*`) is unaffected — it runs one command and exits, so it
  always uses the simple `getClient()` path regardless of `TV_MCP_POOL`.

---

## 2. TvError — typed errors (OPS-1)

`src/core/TvError.js`. Every failure that crosses the pool boundary is a `TvError`
with a stable `code` and a `retryable` flag, so agents can distinguish
`POOL_EXHAUSTED` (retry later) from `CHART_TIMEOUT` (don't retry the same op) from
`CDP_DOWN` (restart TradingView).

```js
// src/core/TvError.js

/**
 * Stable error codes surfaced to MCP tool callers.
 * retryable = the same call may succeed if retried after a short delay.
 */
const RETRYABLE = new Set(['POOL_EXHAUSTED', 'POOL_DRAINING', 'CHART_TIMEOUT']);

export const TV_ERROR_CODES = Object.freeze({
  POOL_EXHAUSTED: 'POOL_EXHAUSTED', // no free tab within tab-timeout
  POOL_DRAINING: 'POOL_DRAINING',   // acquire during shutdown
  CHART_TIMEOUT: 'CHART_TIMEOUT',   // per-op evaluate timed out / readiness timed out
  CDP_DOWN: 'CDP_DOWN',             // CDP unreachable; TradingView likely not running
  TARGET_GONE: 'TARGET_GONE',       // pinned tab no longer exists
  JS_EVAL: 'JS_EVAL',               // exception thrown inside the renderer
  REPLAY_ACTIVE: 'REPLAY_ACTIVE',   // global replay lock held by another session
});

export class TvError extends Error {
  /**
   * @param {string} code  one of TV_ERROR_CODES
   * @param {string} message
   * @param {{ cause?: any, retryable?: boolean, meta?: object }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'TvError';
    this.code = code;
    this.retryable = opts.retryable ?? RETRYABLE.has(code);
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (opts.meta) this.meta = opts.meta;
  }

  /** Normalize any thrown value into a TvError (default JS_EVAL, non-retryable). */
  static from(err, fallbackCode = 'JS_EVAL') {
    if (err instanceof TvError) return err;
    const msg = err?.message || String(err);
    return new TvError(fallbackCode, msg, { cause: err });
  }
}
```

`retryable` defaults from the code, but callers may override (e.g. a `CDP_DOWN` raised
mid-drain is not retryable). Tool wrappers serialize `{ code, retryable }` into the MCP
result (§11).

---

## 3. src/core/_safe.js — extract sanitizers (PHASE 0a)

`safeString` / `requireFinite` live in `connection.js` today, which means ~30 core
modules import them *from the connection layer*. The lint rule that forbids templating
raw user strings into `evaluate()` would have to special-case those imports. Instead we
relocate them to a dependency-free `src/core/_safe.js` and re-export from
`connection.js` for one release so the 30 existing imports keep working.

```js
// src/core/_safe.js
//
// Zero-dependency CDP injection sanitizers. The single source of truth.
// Imported by every core module that interpolates user values into evaluate()
// expression strings. The DI lint rule (PHASE 0e) keys off imports from THIS file.

/**
 * Escape a value into a safe JS string literal (with surrounding quotes).
 * JSON.stringify neutralizes quotes, backticks, template `${}`, and control chars.
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate a value is a finite number; throw otherwise.
 * Prevents NaN/Infinity from reaching APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${name} must be a finite number, got: ${value}`);
  }
  return n;
}

/**
 * Build a regex SOURCE STRING from a user pattern, either escaped to a literal or
 * validated as a real pattern. Returns the source string (never a RegExp), so callers
 * still pass it through safeString() at the evaluate() boundary.
 */
export function safeRegex(pattern, { literal = true } = {}) {
  const src = String(pattern);
  if (literal) return src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try { new RegExp(src); } catch (e) {
    throw new Error(`Invalid regex pattern: ${e.message}`);
  }
  return src;
}
```

`connection.js` keeps thin re-exports during the transition:

```js
// src/connection.js (transition shim — removed one release after cutover)
export { safeString, requireFinite } from './core/_safe.js';
```

---

## 4. src/core/_resolve.js — makeResolver (PHASE 0b)

Today each module hand-rolls a `_resolve(deps)` that falls back to the module-global
`_evaluate`. That fallback is exactly what makes the pool leaky — a core fn called
without `_deps` silently grabs the singleton instead of the leased tab. `makeResolver`
standardizes the pattern and supports a **strict mode** that throws when a dependency is
missing instead of silently using the singleton.

```js
// src/core/_resolve.js

const STRICT = process.env.TV_MCP_STRICT_DI === '1';

/**
 * Build a resolver for a fixed set of dependency names.
 *
 * @param {Object<string, Function>} fallbacks  name → module-global implementation
 * @returns {(deps?: object) => object}  resolve(_deps) → { name: fn, ... }
 *
 * Stage A (default): when a dep is absent, use the module-global fallback but emit a
 *   one-time stderr warning per name, so we can see which call sites still leak.
 * Stage B (TV_MCP_STRICT_DI=1): when a dep is absent, THROW. Used in CI to prove
 *   every core call site threads _deps. PHASE 0f makes the whole suite green here.
 */
export function makeResolver(fallbacks) {
  const names = Object.keys(fallbacks);
  const warned = new Set();
  return function resolve(deps) {
    const out = {};
    for (const name of names) {
      const provided = deps && deps[name];
      if (provided) { out[name] = provided; continue; }
      if (STRICT) {
        throw new TypeError(
          `[strict-di] missing _deps.${name} — core fn must be called via withTab()`
        );
      }
      if (!warned.has(name)) {
        warned.add(name);
        process.stderr.write(
          `[di-warn] _deps.${name} not provided; falling back to singleton\n`
        );
      }
      out[name] = fallbacks[name];
    }
    return out;
  };
}
```

A migrated module looks like:

```js
// src/core/chart.js (after PHASE 0c)
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync } from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';
import { safeString, requireFinite } from './_safe.js';
import { makeResolver } from './_resolve.js';

const _resolve = makeResolver({
  evaluate: _evaluate,
  evaluateAsync: _evaluateAsync,
  waitForChartReady: _waitForChartReady,
});
// getState / setSymbol / … unchanged — they already call _resolve(_deps).
```

The singleton fallback is **removed** once `TV_MCP_STRICT_DI=1` is green: at that point
`fallbacks` can be set to throwing stubs in production too, but we keep warn-mode as the
default for the rollback window.

---

## 5. CdpConnection.js (M-5, ARCH-1, 'disconnect')

`src/core/CdpConnection.js`. Wraps one `chrome-remote-interface` client bound to one
target. Adds a **per-tab serial queue** so calls to the same tab can't interleave inside
the renderer, a **per-op timeout** so a hung `evaluate()` (e.g. a 10s `waitForChartReady`
spin) can't wedge the tab forever, and a **bounded chain** that resets to a fresh
resolved promise when it drains (so the promise chain never grows without bound). Emits
`'disconnect'` when the underlying CDP client dies.

```js
// src/core/CdpConnection.js
import { EventEmitter } from 'node:events';
import { TvError } from './TvError.js';

const DEFAULT_EVAL_TIMEOUT = Number(process.env.TV_MCP_EVAL_TIMEOUT_MS || 15000);

/**
 * One CDP connection to one TradingView chart target.
 * - run(fn): serial queue; fn receives the raw CDP client. Per-op timeout applies.
 * - evaluate / evaluateAsync: convenience wrappers used by core _deps injection.
 * - 'disconnect' event: fired once when the client drops (CDP-level disconnect).
 */
export class CdpConnection extends EventEmitter {
  /**
   * @param {object} client  chrome-remote-interface client
   * @param {object} target  { id, url, title } CDP target descriptor
   * @param {{ role?: 'primary'|'worker', evalTimeoutMs?: number, selfCreated?: boolean }} opts
   */
  constructor(client, target, opts = {}) {
    super();
    this.client = client;
    this.target = target;
    this.id = target.id;
    this.role = opts.role || 'worker';
    this.selfCreated = !!opts.selfCreated;
    this.evalTimeoutMs = opts.evalTimeoutMs || DEFAULT_EVAL_TIMEOUT;
    this.dead = false;
    this.route = null;          // set by the pool while leased: 'visible'|'headless'|{tabId}
    this._chain = Promise.resolve(); // serial queue tail
    this._depth = 0;            // outstanding queued ops; chain resets to fresh when 0

    // Surface CDP-level disconnects as a single 'disconnect' event + dead flag.
    if (typeof client.on === 'function') {
      client.on('disconnect', () => this._markDead('cdp-disconnect'));
      client.on('error', () => this._markDead('cdp-error'));
    }
  }

  _markDead(reason) {
    if (this.dead) return;
    this.dead = true;
    this.emit('disconnect', reason);
  }

  /**
   * Enqueue fn on the serial chain. fn(client) runs after all prior ops on this tab.
   * Per-op timeout: if fn doesn't settle within evalTimeoutMs, reject CHART_TIMEOUT.
   * The tab stays usable for the NEXT op (we don't kill the connection on a timeout —
   * the hung op is abandoned but the chain advances).
   */
  run(fn) {
    if (this.dead) {
      return Promise.reject(new TvError('CDP_DOWN', `tab ${this.id} is dead`));
    }
    this._depth += 1;
    const result = this._chain.then(() => this._withTimeout(fn));
    // Swallow the result on the chain itself so one rejection doesn't poison the next op.
    this._chain = result.then(noop, noop).then(() => {
      this._depth -= 1;
      // Bounded chain: when the queue fully drains, reset to a fresh resolved promise
      // so we never accumulate an ever-deepening .then() graph.
      if (this._depth === 0) this._chain = Promise.resolve();
    });
    return result;
  }

  _withTimeout(fn) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new TvError('CHART_TIMEOUT',
          `evaluate exceeded ${this.evalTimeoutMs}ms on tab ${this.id}`,
          { meta: { tabId: this.id } }));
      }, this.evalTimeoutMs);
    });
    return Promise.race([Promise.resolve().then(() => fn(this.client)), timeout])
      .finally(() => clearTimeout(timer));
  }

  /** evaluate(expr) — same contract as connection.evaluate, but tab-scoped + queued. */
  evaluate(expression, opts = {}) {
    return this.run(async (c) => {
      const r = await c.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: opts.awaitPromise ?? false,
        ...opts,
      });
      if (r.exceptionDetails) {
        const msg = r.exceptionDetails.exception?.description
          || r.exceptionDetails.text || 'Unknown evaluation error';
        throw new TvError('JS_EVAL', `JS evaluation error: ${msg}`,
          { meta: { tabId: this.id } });
      }
      return r.result?.value;
    });
  }

  evaluateAsync(expression) {
    return this.evaluate(expression, { awaitPromise: true });
  }

  /** Detach CDP (does NOT close the browser tab — pool handles tab lifecycle). */
  async dispose() {
    this._markDead('dispose');
    try { await this.client.close(); } catch { /* already gone */ }
  }
}

function noop() {}
```

Key properties:

- **Serial per tab, parallel across tabs.** Two ops on the same `CdpConnection` queue;
  ops on different connections run concurrently — exactly the concurrency we want.
- **Hung op is contained (M-5).** A 15s timeout rejects `CHART_TIMEOUT`; the chain
  still advances so the tab is usable for the next op. T-NEW-10 asserts this.
- **Bounded chain (M-5).** `_chain` resets to `Promise.resolve()` whenever `_depth`
  hits 0, so a long-lived tab never accumulates an unbounded promise graph.

---

## 6. cdpDiscovery.js (CDP-1, CDP-2, OPS-4)

`src/core/cdpDiscovery.js`. Owns target discovery and **tab creation**. Tab creation
attempts `PUT /json/new` first (best-effort) and falls through to the existing
`core/tab.newTab()` **Cmd+T** path on 404/405 — because `src/core/tab.js` already uses
Cmd+T, strongly implying `/json/new` is unavailable on this Electron build (CDP-1).
Readiness uses the **real** `waitForChartReady(conn)` from `src/wait.js` (CDP-2), and we
pass the **already-created final connection** to it — no throwaway probe connection
(OPS-4).

```js
// src/core/cdpDiscovery.js
import CDP from 'chrome-remote-interface';
import { CdpConnection } from './CdpConnection.js';
import { waitForChartReady } from '../wait.js';
import { TvError } from './TvError.js';

const HOST = process.env.TV_MCP_CDP_HOST || 'localhost';
const PORT = Number(process.env.TV_MCP_CDP_PORT || 9222);
const CHART_RE = /tradingview\.com\/chart/i;

/** GET /json/list, filtered to TradingView chart page targets. */
export async function listChartTargets() {
  let targets;
  try {
    const resp = await fetch(`http://${HOST}:${PORT}/json/list`);
    targets = await resp.json();
  } catch (e) {
    throw new TvError('CDP_DOWN', `CDP unreachable at ${HOST}:${PORT}: ${e.message}`,
      { cause: e });
  }
  return targets.filter(t => t.type === 'page' && CHART_RE.test(t.url));
}

/** Attach a CdpConnection to an existing target id, enabling required domains. */
export async function attach(target, { role = 'worker', selfCreated = false } = {}) {
  let client;
  try {
    client = await CDP({ host: HOST, port: PORT, target: target.id });
    await client.Runtime.enable();
    await client.Page.enable();
    await client.DOM.enable();
    await enableSafe(client, 'Log');
    if (process.env.TV_MCP_NETWORK === '1') await enableSafe(client, 'Network');
  } catch (e) {
    if (client) { try { await client.close(); } catch {} }
    throw new TvError('CDP_DOWN', `attach failed for ${target.id}: ${e.message}`,
      { cause: e });
  }
  return new CdpConnection(client, target, { role, selfCreated });
}

async function enableSafe(c, domain) {
  if (!c[domain]) return;
  try { await c[domain].enable(); } catch { /* domain unsupported */ }
}

/**
 * Create a NEW chart tab and return a ready CdpConnection for it.
 *
 * Strategy (CDP-1):
 *   1. Best-effort: PUT /json/new?<chartUrl>. If the Electron build supports it we get
 *      a target descriptor back immediately.
 *   2. On 404/405/network refusal: fall back to the EXISTING Cmd+T path. We diff the
 *      target list before/after to find the newly-created target.
 *
 * Readiness (CDP-2 + OPS-4): we attach the FINAL connection first, then drive
 * waitForChartReady against an evaluate bound to THAT connection. No probe connection.
 *
 * @param {{ tabModule: object, chartUrl?: string }} deps
 *   tabModule = core/tab.js (injected so tests can stub the Cmd+T side effect)
 * @returns {{ conn: CdpConnection, createdTargetId: string }}
 */
export async function createNewTarget({ tabModule, chartUrl } = {}) {
  const before = new Set((await listChartTargets()).map(t => t.id));

  // 1) Best-effort PUT /json/new
  let created = await tryPutJsonNew(chartUrl);

  // 2) Fallback: Cmd+T via the existing keyboard path in core/tab.js
  if (!created) {
    await tabModule.newTab();             // dispatches Cmd/Ctrl+T, waits ~2s internally
    const after = await listChartTargets();
    created = after.find(t => !before.has(t.id)) || null;
    if (!created) {
      throw new TvError('CDP_DOWN',
        'tab creation failed: neither PUT /json/new nor Cmd+T produced a new target');
    }
  }

  const conn = await attach(created, { role: 'worker', selfCreated: true });

  // Readiness against the FINAL connection (real wait.js). waitForChartReady only checks
  // loading spinners, bar-count stability, and an optional symbol match — it does NOT
  // detect login screens, subscription walls, or blank tabs. It returns `false` on
  // timeout; the pool proceeds with creation regardless — a newly-created tab that lands
  // on a login screen or subscription wall will time out on the first `evaluate()` call
  // and self-evict via the `'disconnect'` handler.
  // wait.js's waitForChartReady uses evaluate(); we pass conn.evaluate via _deps shim.
  await waitForChartReady(null, null, undefined, {
    evaluate: (expr) => conn.evaluate(expr),
  });
  // Readiness is best-effort (mirrors today's behavior): a false return doesn't fail
  // creation — the tab exists and is usable; the first real op surfaces genuine errors.
  return { conn, createdTargetId: created.id };
}

async function tryPutJsonNew(chartUrl) {
  const url = chartUrl
    ? `http://${HOST}:${PORT}/json/new?${encodeURIComponent(chartUrl)}`
    : `http://${HOST}:${PORT}/json/new`;
  try {
    const resp = await fetch(url, { method: 'PUT' });
    if (resp.status === 404 || resp.status === 405) return null; // unsupported build
    if (!resp.ok) return null;
    const t = await resp.json();
    if (t && t.id) return { id: t.id, url: t.url || chartUrl || '', title: t.title || '' };
    return null;
  } catch {
    return null; // network refused / method unsupported → fall back to Cmd+T
  }
}

/** DELETE /json/close/<id> — used by the pool to clean up self-created tabs (OPS-2). */
export async function closeTarget(id) {
  try {
    const resp = await fetch(`http://${HOST}:${PORT}/json/close/${id}`, { method: 'DELETE' });
    return resp.ok;
  } catch { return false; }
}
```

> **`wait.js` signature note (CDP-2/OPS-4):** `waitForChartReady` currently reads the
> module-global `evaluate`. PHASE 0 threads an optional `_deps` 4th arg
> (`{ evaluate }`) through it — identical pattern to the core modules — so discovery can
> drive readiness against the freshly-attached connection rather than the singleton.

---

## 7. CdpPool.js (I-1…I-6, OPS-2, CDP-3)

`src/core/CdpPool.js`. The heart of the design. Bounded set of `CdpConnection`s with a
fair waiter queue, three placement strategies, a global replay lock, self-created-tab
tracking, and a deadlined drain.

### 7.1 State

```js
// src/core/CdpPool.js
import * as discovery from './cdpDiscovery.js';
import { TvError } from './TvError.js';

const MAX_TABS = Math.max(1, Number(process.env.TV_MCP_MAX_TABS || 3));
const TAB_TIMEOUT_MS = Number(process.env.TV_MCP_TAB_TIMEOUT_MS || 20000);
const DRAIN_TIMEOUT_MS = Number(process.env.TV_MCP_DRAIN_TIMEOUT_MS || 8000);

export class CdpPool {
  /**
   * @param {{ tabModule: object, discovery?: object, maxTabs?: number }} deps
   *   tabModule  = core/tab.js (for Cmd+T fallback); injectable for tests
   *   discovery  = cdpDiscovery (injectable for tests)
   */
  constructor(deps = {}) {
    this.maxTabs = deps.maxTabs || MAX_TABS;
    this._tabModule = deps.tabModule;
    this._discovery = deps.discovery || discovery;

    this._idle = [];          // CdpConnection[] available to lease
    this._used = new Set();   // CdpConnection[] currently leased
    this._waiters = [];       // { route, wantId, resolve, reject, timer }
    this._pendingCount = 0;   // in-flight tab creations (I-1: ALL paths increment this)
    this._primary = null;     // adopted user tab (slot 0); never self-closed
    this._primaryInitPromise = null; // one-shot guard: in-flight ensurePrimary (M2)
    this._createdTargetIds = new Set(); // self-made tabs to close on drain (OPS-2)
    this._replayLock = null;  // null | { tabId, waiters: [] }  (I-4 global exclusive)
    this._draining = false;
  }

  // size counts idle + leased + in-flight creations so capacity checks are race-free.
  get size() { return this._idle.length + this._used.size + this._pendingCount; }
```

### 7.2 ensurePrimary — adopt the user's tab (I-1, CDP-3)

`ensurePrimary` adopts (or creates) slot 0 — the user's visible chart. **Its creation
path is wrapped in `_pendingCount` (I-1)** so it counts against capacity like every
other create path, and it uses the **same 5-retry exponential backoff** as the legacy
`connect()` (CDP-3).

**Re-entrancy guard (M2).** `ensurePrimary` is async and previously had only a
`if (this._primary && !this._primary.dead) return` check. Two concurrent callers could
both pass that guard before either set `this._primary` and both fire Cmd+T — creating
duplicate primaries. A one-shot `_primaryInitPromise` guard fixes this: the first caller
starts `_doEnsurePrimary()`, and ALL concurrent callers await the **same** in-flight
promise. On settle (success or failure) the promise is nulled in `finally`, so a later
call can retry after a failed init.

```js
  /**
   * Ensure the primary (visible) tab exists and return it. Adopts the first existing
   * chart target; if none exist, creates one. 5-retry exponential backoff (CDP-3).
   * Creation increments _pendingCount so it can't push size past maxTabs (I-1).
   *
   * Re-entrancy (M2): concurrent callers share ONE in-flight _primaryInitPromise so
   * _doEnsurePrimary (and thus Cmd+T) runs exactly once. The promise is nulled on
   * settle, so a failed init can be retried by a subsequent call.
   */
  async ensurePrimary() {
    if (this._primary && !this._primary.dead) return this._primary;

    if (this._primaryInitPromise) return this._primaryInitPromise;
    this._primaryInitPromise = this._doEnsurePrimary();
    try {
      await this._primaryInitPromise;
    } finally {
      this._primaryInitPromise = null;
    }
    return this._primary;
  }

  /** Actual adopt-or-create with 5-retry exponential backoff (CDP-3). */
  async _doEnsurePrimary() {
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const targets = await this._discovery.listChartTargets();
        if (targets.length > 0) {
          // Adopt the first existing user tab as primary. NOT self-created → never closed.
          this._primary = await this._discovery.attach(targets[0], { role: 'primary' });
          this._wireDisconnect(this._primary);
          this._idle.push(this._primary);
          return this._primary;
        }
        // No tab at all → create one, counting it against capacity (I-1).
        this._pendingCount += 1;
        try {
          const { conn } =
            await this._discovery.createNewTarget({ tabModule: this._tabModule });
          conn.role = 'primary';
          // We do NOT add it to _createdTargetIds: it is the user's ONLY chart, so it
          // must never be auto-closed on drain (OPS-2 / T-NEW-12).
          this._primary = conn;
          this._wireDisconnect(conn);
          this._idle.push(conn);
          return conn;
        } finally {
          this._pendingCount -= 1;
        }
      } catch (err) {
        lastErr = err;
        const delay = Math.min(500 * 2 ** attempt, 30000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw TvError.from(lastErr, 'CDP_DOWN');
  }
```

### 7.3 wireDisconnect — react to tab death (I-2)

```js
  _wireDisconnect(conn) {
    conn.once('disconnect', () => {
      conn.dead = true;
      const wasIdle = this._idle.indexOf(conn);
      if (wasIdle >= 0) this._idle.splice(wasIdle, 1);
      if (this._primary === conn) this._primary = null;
      // If it died while idle and waiters are queued, grow a replacement now (I-2).
      // If it died while LEASED, release() handles the re-grow when the lease returns.
      if (wasIdle >= 0) this._maybeGrowForWaiters();
    });
  }
```

### 7.4 acquire(route) — three placement strategies (ARCH-1, I-4, I-5)

```js
  /**
   * Lease a connection for the given route.
   *   'visible'  → the primary tab (slot 0). Serializes with other visible ops.
   *   'headless' → any non-primary idle tab; grow up to maxTabs; else queue.
   *   { tabId }  → exact tab. Fast-fail TARGET_GONE if it doesn't exist (I-5).
   *
   * Replay global lock (I-4): if a replay lock is held, every acquire BLOCKS (queues
   * on the replay lock) until replay_stop releases it — EXCEPT an acquire for the
   * replay-owning tabId, which proceeds. New acquires don't fail, they wait.
   */
  async acquire(route = 'headless') {
    if (this._draining) {
      throw new TvError('POOL_DRAINING', 'pool is shutting down');
    }

    // Global replay gate (I-4).
    if (this._replayLock) {
      const ownerId = this._replayLock.tabId;
      const targetsOwner = isTabRoute(route) && route.tabId === ownerId;
      if (!targetsOwner) {
        await this._waitForReplayRelease();  // block, then retry same route
        return this.acquire(route);
      }
    }

    if (route === 'visible') return this._acquireVisible();
    if (isTabRoute(route)) return this._acquirePinned(route.tabId);
    return this._acquireHeadless();
  }

  async _acquireVisible() {
    const primary = await this.ensurePrimary();
    if (this._idle.includes(primary)) return this._take(primary, 'visible');
    // Primary is busy → queue a targeted waiter for it.
    return this._enqueueWaiter('visible', primary.id);
  }

  _acquirePinned(tabId) {
    const idle = this._idle.find(c => c.id === tabId);
    if (idle) return Promise.resolve(this._take(idle, { tabId }));
    const leased = [...this._used].find(c => c.id === tabId);
    if (leased) return this._enqueueWaiter({ tabId }, tabId);
    // Not idle, not leased, and we can't predict a pending tab's id → it's gone (I-5).
    return Promise.reject(new TvError('TARGET_GONE',
      `pinned tab ${tabId} is not idle, leased, or pending`, { meta: { tabId } }));
  }

  async _acquireHeadless() {
    // Prefer a non-primary idle worker; fall back to any idle (incl. primary).
    const worker = this._idle.find(c => c.role !== 'primary') || this._idle[0];
    if (worker) return this._take(worker, 'headless');

    // Grow if we have headroom (I-1: _pendingCount is part of size).
    if (this.size < this.maxTabs) return this._growHeadless();

    // At capacity → queue an untargeted waiter.
    return this._enqueueWaiter('headless', null);
  }

  /** Create a new worker tab, counting it against capacity the whole time (I-1). */
  async _growHeadless() {
    this._pendingCount += 1;
    try {
      const { conn, createdTargetId } =
        await this._discovery.createNewTarget({ tabModule: this._tabModule });
      this._createdTargetIds.add(createdTargetId); // OPS-2: track for cleanup
      this._wireDisconnect(conn);
      this._idle.push(conn);
      return this._take(conn, 'headless');
    } catch (err) {
      // The create failed; reject the head UNTARGETED waiter so it doesn't starve (I-3).
      this._failPendingSlot(err);
      throw TvError.from(err, 'CDP_DOWN');
    } finally {
      this._pendingCount -= 1;
    }
  }

  _take(conn, route) {
    const i = this._idle.indexOf(conn);
    if (i >= 0) this._idle.splice(i, 1);
    this._used.add(conn);
    conn.route = route;
    return conn;
  }
```

### 7.5 Waiter queue + the fixes (I-2, I-3, I-5)

```js
  _enqueueWaiter(route, wantId) {
    return new Promise((resolve, reject) => {
      const waiter = { route, wantId, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const idx = this._waiters.indexOf(waiter);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new TvError('POOL_EXHAUSTED',
          `no tab available within ${TAB_TIMEOUT_MS}ms for route ${routeLabel(route)}`,
          { meta: { route } }));
      }, TAB_TIMEOUT_MS);
      this._waiters.push(waiter);
      this._serviceWaiters(); // serviceable immediately if a tab freed between checks
    });
  }

  /** Hand idle tabs to compatible waiters, oldest-first. */
  _serviceWaiters() {
    for (let i = 0; i < this._waiters.length; ) {
      const w = this._waiters[i];
      const conn = this._matchIdle(w);
      if (!conn) { i += 1; continue; }
      clearTimeout(w.timer);
      this._waiters.splice(i, 1);
      w.resolve(this._take(conn, w.route));
    }
  }

  _matchIdle(w) {
    if (w.wantId) return this._idle.find(c => c.id === w.wantId) || null;
    // Untargeted (headless): prefer a worker, else any idle.
    return this._idle.find(c => c.role !== 'primary') || this._idle[0] || null;
  }

  /**
   * I-2 fix: a tab DIED while waiters are queued and capacity is now free.
   * Grow a replacement (entering the create path with _pendingCount) so the oldest
   * untargeted waiter gets serviced instead of starving to timeout.
   */
  _maybeGrowForWaiters() {
    const hasUntargeted = this._waiters.some(w => !w.wantId);
    if (!hasUntargeted) return;
    if (this.size >= this.maxTabs) return;
    if (this._draining) return;
    this._growHeadless().catch((err) => {
      // The grow itself failed → surface to the head untargeted waiter (I-3).
      this._failPendingSlot(err);
    });
  }

  /**
   * I-3 fix: a pending tab open FAILED. Reject only the first UNTARGETED waiter
   * (the one that would have used that anonymous slot) — never a pinned/visible waiter
   * that is waiting for a specific, still-alive tab. Then re-service in case other
   * idle capacity covers remaining waiters.
   */
  _failPendingSlot(err) {
    const idx = this._waiters.findIndex(w => !w.wantId);
    if (idx >= 0) {
      const w = this._waiters[idx];
      clearTimeout(w.timer);
      this._waiters.splice(idx, 1);
      w.reject(TvError.from(err, 'CDP_DOWN'));
    }
    this._serviceWaiters();
  }
```

### 7.6 release — dead-tab re-grow trigger (I-2), idempotent (T-NEW-8)

```js
  /**
   * Return a leased connection. Idempotent for double-release; no-op for foreign conns
   * (T-NEW-8). If the released tab is DEAD and waiters are queued with free capacity,
   * grow a replacement (I-2) instead of just returning it to idle.
   */
  release(conn) {
    if (!conn || !this._used.has(conn)) return; // foreign or already released → no-op
    this._used.delete(conn);
    conn.route = null;

    if (conn.dead) {
      if (this._primary === conn) this._primary = null;
      this._maybeGrowForWaiters();  // I-2: free capacity + waiting → replace the tab
      this._serviceWaiters();
      return;
    }

    this._idle.push(conn);
    this._serviceWaiters();
  }
```

### 7.7 Replay global lock (I-4)

```js
  /**
   * Acquire the GLOBAL replay lock and a lease on the visible tab. While held, every
   * non-owner acquire BLOCKS until releaseReplay() (I-4). Returns the owning connection.
   * Replay runs on the visible tab because _replayApi is session-global in the renderer,
   * so a worker tab buys nothing and the replay UI is user-facing.
   */
  async acquireReplay() {
    if (this._replayLock) {
      await this._waitForReplayRelease(); // another replay owns it → wait, then retry
      return this.acquireReplay();
    }
    const conn = await this._acquireVisible();
    this._replayLock = { tabId: conn.id, waiters: [] };
    return conn;
  }

  /** Release the global replay lock + the lease, and wake everyone blocked on it. */
  releaseReplay(conn) {
    if (this._replayLock && conn) this.release(conn);
    const lock = this._replayLock;
    this._replayLock = null;
    if (lock) for (const { resolve } of lock.waiters) resolve();
    this._serviceWaiters();
  }

  // Waiters are stored as { resolve, reject } so drain() can reject them with
  // POOL_DRAINING (rather than leaving them to time out into POOL_EXHAUSTED).
  _waitForReplayRelease() {
    return new Promise((resolve, reject) => {
      if (!this._replayLock) return resolve();
      this._replayLock.waiters.push({ resolve, reject });
    });
  }
```

### 7.8 drain — deadlined, closes only self-made tabs (I-6, OPS-2)

```js
  /**
   * Graceful shutdown. Stop accepting new acquires, wait up to deadlineMs for leased
   * ops to return, then FORCE-close anything still leased (I-6). Always resolves.
   * Closes ONLY self-created browser tabs (OPS-2 / T-NEW-12), never the adopted primary.
   */
  async drain(deadlineMs = DRAIN_TIMEOUT_MS) {
    this._draining = true;

    // Reject queued waiters immediately — they can't be served during shutdown.
    for (const w of this._waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new TvError('POOL_DRAINING', 'pool draining'));
    }

    // Flush any acquires blocked on the replay gate (callers parked in
    // _waitForReplayRelease). Without this they wait out TAB_TIMEOUT_MS and get
    // POOL_EXHAUSTED instead of the correct POOL_DRAINING.
    if (this._replayLock) {
      const drained = this._replayLock.waiters.splice(0);
      for (const { reject } of drained) {
        reject(new TvError('POOL_DRAINING', 'Pool is draining', { retryable: false }));
      }
      this._replayLock = null;
    }

    const start = Date.now();
    while (this._used.size > 0 && Date.now() - start < deadlineMs) {
      await new Promise(r => setTimeout(r, 50)); // poll every 50ms (I-6)
    }

    // Force-detach whatever remains (idle + still-leased past the deadline).
    const all = [...this._idle, ...this._used];
    this._idle = [];
    this._used.clear();
    await Promise.all(all.map(c => c.dispose().catch(() => {})));

    // OPS-2: close ONLY browser tabs WE created. Never the adopted primary/user tabs.
    await Promise.all([...this._createdTargetIds].map(id =>
      this._discovery.closeTarget(id).catch(() => {})));
    this._createdTargetIds.clear();
    this._primary = null;
    this._replayLock = null;
  }
}

// --- helpers ---
function isTabRoute(r) { return r && typeof r === 'object' && typeof r.tabId === 'string'; }
function routeLabel(r) { return isTabRoute(r) ? `tab:${r.tabId}` : String(r); }
```

---

## 8. replaySession.js (I-4, I-7)

`src/core/replaySession.js`. Replay is the one workflow that must pin a tab across many
calls (`replay_start` → `replay_step` → … → `replay_stop`). Because `_replayApi` is a
**session-global singleton in the renderer** (I-4), per-tab affinity cannot isolate it —
so replay takes the pool's **global exclusive lock**. `replay_run` holds the lease for
its whole autoplay loop and passes the **already-held connection** into every inner call
so it never re-acquires and deadlocks (I-7).

```js
// src/core/replaySession.js
import * as replay from './replay.js';
import { TvError } from './TvError.js';

const REPLAY_IDLE_EXPIRY_MS = Number(process.env.TV_MCP_REPLAY_EXPIRY_MS || 10 * 60 * 1000);

/**
 * Holds the pool's global replay lock + the pinned connection for the duration of a
 * replay session. All replay_* tools route through here so they share one leased tab.
 */
export class ReplaySession {
  constructor(pool) {
    this.pool = pool;
    this.conn = null;          // pinned, replay-owning connection
    this._expiryTimer = null;
  }

  get active() { return !!this.conn; }

  _bumpExpiry() {
    clearTimeout(this._expiryTimer);
    this._expiryTimer = setTimeout(() => {
      // Auto-expire a forgotten replay session so the global lock can't wedge the pool.
      this.stop().catch(() => {});
    }, REPLAY_IDLE_EXPIRY_MS);
  }

  /** replay_start: take the global lock + pin the visible tab, then start replay. */
  async start(args) {
    if (this.active) {
      // Re-entrant start on the same session is allowed (restart on the held tab).
      return this._run((deps) => replay.start({ ...args, _deps: deps }));
    }
    this.conn = await this.pool.acquireReplay(); // global lock (I-4)
    this._bumpExpiry();
    try {
      return await this._run((deps) => replay.start({ ...args, _deps: deps }));
    } catch (err) {
      await this.stop().catch(() => {});
      throw err;
    }
  }

  step(args)  { return this._guard((d) => replay.step({ ...args, _deps: d })); }
  autoplay(a) { return this._guard((d) => replay.autoplay({ ...a, _deps: d })); }
  trade(a)    { return this._guard((d) => replay.trade({ ...a, _deps: d })); }
  status(a)   { return this._guard((d) => replay.status({ ...a, _deps: d })); }

  /**
   * replay_run (I-7): drive the whole autoplay loop on the ONE held connection.
   * The inner start/autoplay/status/stop primitives all receive the SAME _deps bound
   * to this.conn, so no inner call ever re-acquires the tab → no self-deadlock.
   */
  async run(args) {
    if (!this.active) {
      this.conn = await this.pool.acquireReplay();
      this._bumpExpiry();
    }
    const base = this._deps();
    // replay.run() resolves its primitives from _deps; inject held-connection-bound
    // versions so the entire loop stays on this.conn (I-7).
    return replay.run({
      ...args,
      _deps: {
        ...base,
        start:    (a) => replay.start({ ...a, _deps: this._deps() }),
        autoplay: (a) => replay.autoplay({ ...a, _deps: this._deps() }),
        status:   (a) => replay.status({ ...a, _deps: this._deps() }),
        stop:     (a) => replay.stop({ ...a, _deps: this._deps() }),
      },
    });
  }

  /** replay_stop: stop replay, release the global lock + the pinned lease (I-4). */
  async stop(args = {}) {
    if (!this.active) return { success: true, action: 'already_stopped' };
    clearTimeout(this._expiryTimer);
    const conn = this.conn;
    try {
      return await this._run((d) => replay.stop({ ...args, _deps: d }));
    } finally {
      this.conn = null;
      this.pool.releaseReplay(conn); // releases lock + lease, wakes blocked acquires
    }
  }

  _guard(fn) {
    if (!this.active) {
      return Promise.reject(new TvError('REPLAY_ACTIVE',
        'no active replay session; call replay_start first', { retryable: false }));
    }
    return this._run(fn);
  }

  async _run(fn) {
    this._bumpExpiry();
    return fn(this._deps());
  }

  /** _deps bound to the pinned replay connection. */
  _deps() {
    const conn = this.conn;
    return {
      evaluate: (expr, opts) => conn.evaluate(expr, opts),
      evaluateAsync: (expr) => conn.evaluateAsync(expr),
    };
  }
}
```

The pool holds one `ReplaySession` instance (created lazily in `connection.js`, §10).
Because `acquireReplay()` sets `_replayLock`, every other tool's `acquire()` blocks (not
fails) until `releaseReplay()` — satisfying T-NEW-6.

---

## 9. withTab.js (ARCH-1, I-7, OPS-3)

`src/core/withTab.js`. The single entry point tool wrappers use. Resolves the pool,
acquires by route, injects the leased connection's bound `evaluate` into `_deps`, runs
the tool fn, and always releases. Honors `TV_MCP_POOL=0` (legacy bypass) and accepts a
pre-held `connection` so `replay_run` inner calls reuse the same tab (I-7).

```js
// src/core/withTab.js
import { getPool, getLegacyDeps, isPoolDisabled } from '../connection.js';
import { TvError } from './TvError.js';

/**
 * Run `fn(deps)` with a leased tab's connection injected as deps.
 *
 * @param {(deps) => Promise<any>} fn  receives { evaluate, evaluateAsync, connection }
 * @param {{ route?: 'visible'|'headless'|{tabId:string}, connection?: object }} opts
 *   route       placement intent (default 'headless')
 *   connection  pre-held connection (replay_run inner calls) → bypass acquire/release
 */
export async function withTab(fn, opts = {}) {
  const { route = 'headless', connection } = opts;

  // I-7: caller already holds a lease (e.g. replay_run loop) → reuse it, don't acquire.
  if (connection) {
    return fn(depsFor(connection));
  }

  // OPS-3 kill switch: pool disabled → legacy singleton path, pool never instantiated.
  if (isPoolDisabled()) {
    return fn(getLegacyDeps());
  }

  const pool = getPool();
  let conn;
  try {
    conn = await pool.acquire(route);
  } catch (err) {
    throw TvError.from(err, 'POOL_EXHAUSTED');
  }
  try {
    return await fn(depsFor(conn));
  } finally {
    pool.release(conn);
  }
}

function depsFor(conn) {
  return {
    connection: conn,
    evaluate: (expr, o) => conn.evaluate(expr, o),
    evaluateAsync: (expr) => conn.evaluateAsync(expr),
  };
}
```

---

## 10. connection.js additions (OPS-3)

`src/connection.js` keeps the legacy singleton (retained one release per OPS-3) and
gains pool accessors. New tools call `getPool()`; the kill switch routes through
`getLegacyDeps()`.

```js
// src/connection.js  (additions — legacy singleton code above is UNCHANGED)
import { CdpPool } from './core/CdpPool.js';
import { ReplaySession } from './core/replaySession.js';
import * as tabModule from './core/tab.js';

let _pool = null;
let _replaySession = null;

export function isPoolDisabled() {
  return process.env.TV_MCP_POOL === '0';
}

/** Lazily build the singleton pool. Never instantiated when TV_MCP_POOL=0 (T-NEW-11). */
export function getPool() {
  if (isPoolDisabled()) {
    throw new Error('getPool() called while TV_MCP_POOL=0; use getLegacyDeps()');
  }
  if (!_pool) _pool = new CdpPool({ tabModule });
  return _pool;
}

export function getReplaySession() {
  if (!_replaySession) _replaySession = new ReplaySession(getPool());
  return _replaySession;
}

/** Ensure the visible/primary tab exists (called at startup). */
export async function ensurePrimarySlot() {
  if (isPoolDisabled()) { await getClient(); return; }
  await getPool().ensurePrimary();
}

/** Legacy _deps for the TV_MCP_POOL=0 path — bound to the singleton client. */
export function getLegacyDeps() {
  return { evaluate, evaluateAsync };
}

/** Test hook: tear down pool + replay so each test starts clean. */
export async function resetPool() {
  if (_pool) { try { await _pool.drain(0); } catch {} }
  _pool = null;
  _replaySession = null;
}
```

---

## 11. Tool wrapper pattern (OPS-1, ARCH-1)

Tool files keep their thin Zod-validated shape; the only change is wrapping the core
call in `withTab(fn, { route })` and surfacing `{ code, retryable }` from any `TvError`.

```js
// src/tools/chart.js (illustrative — visible-route + headless-route tools)
import { withTab } from '../core/withTab.js';
import * as chart from '../core/chart.js';
import { jsonResult } from './_format.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerChartTools(server) {
  server.tool('chart_set_symbol', { /* zod */ }, async ({ symbol }) => {
    try {
      // chart_set_symbol mutates the USER's chart → route 'visible'.
      const out = await withTab((deps) => chart.setSymbol({ symbol, _deps: deps }),
        { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_fetch_ohlcv', { /* zod */ }, async (args) => {
    try {
      // Fan-out read on a throwaway worker → route 'headless'.
      const out = await withTab((deps) => chart.fetchOhlcv({ ...args, _deps: deps }),
        { route: 'headless' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });
}
```

Replay tools route through the shared `ReplaySession`:

```js
// src/tools/replay.js (illustrative)
import { getReplaySession } from '../connection.js';

server.tool('replay_start', { /* zod */ }, async ({ date }) => {
  try { return jsonResult(await getReplaySession().start({ date })); }
  catch (err) { return fail(err); }
});
server.tool('replay_run', { /* zod */ }, async (args) => {
  try { return jsonResult(await getReplaySession().run(args)); }
  catch (err) { return fail(err); }
});
```

Route assignment cheat-sheet:

| Route       | Tools |
|-------------|-------|
| `visible`   | `chart_set_*`, `chart_scroll_to_date`, `chart_set_visible_range`, `chart_manage_indicator`, `draw_*`, `ui_*`, `capture_screenshot`, `layout_switch` |
| `headless`  | `chart_fetch_ohlcv`, `batch_run` per-symbol legs, `symbol_search*`, `news_*`, non-user-facing reads |
| `{ tabId }` | replay (via `ReplaySession`, which pins the visible tab under the global lock) |

`jsonResult()` is unchanged; the wrapper just adds three fields to the `success: false`
object. Agents read `retryable` to decide whether to back off and retry.

---

## 12. PHASE 0 — DI migration (ARCH-2)

PHASE 0 makes DI real before any pool code lands. Six steps, in order:

| Step | Action | Done when |
|------|--------|-----------|
| **0a** | Create `src/core/_safe.js` with `safeString`/`requireFinite`/`safeRegex`. Re-export both from `connection.js`. Update the ~30 import sites to import from `_safe.js` (codemod). | All sanitizer imports resolve to `_safe.js`; `sanitization.test.js` green. |
| **0b** | Add `src/core/_resolve.js` `makeResolver()` (warn fallback / strict throw). | Unit test: warn mode warns once per name; strict mode throws. |
| **0c** | Thread `_deps` through the **8 existing-DI modules** (chart, data, diagnostics, drawing, news, options, pine, replay) by replacing each hand-rolled `_resolve` with `makeResolver`. No behavior change. | Existing unit tests pass unchanged. |
| **0d** | Thread `_deps` through the **10 net-new (no-DI) modules** (alerts, batch, capture, health, indicators, pane, stream, tab, ui, watchlist) — add `makeResolver` + accept `_deps` on every exported fn that calls `evaluate`. Also thread optional `_deps` (4th arg) through `wait.js` `waitForChartReady`. | Every core fn accepts `_deps`. |
| **0e** | Add the **lint rule** (custom ESLint): forbid templating a non-`safeString`/`requireFinite` value into an `evaluate()` arg, and forbid importing `evaluate` from `connection.js` inside `core/*` except via `_deps`. Add LAST so it doesn't block 0a–0d churn. | Lint passes repo-wide. |
| **0f** | Run the full suite under `TV_MCP_STRICT_DI=1`. Fix any call site that still leaks to the singleton. | `TV_MCP_STRICT_DI=1 npm test` green. |

After 0f, the singleton fallback in `makeResolver` is proven unused by tests; we keep
warn-mode as the production default for the rollback window, then delete it.

> **The 10 net-new modules (0d).** A scan of `src/core/*.js` shows these 10 modules
> (`alerts`, `batch`, `capture`, `health`, `indicators`, `pane`, `stream`, `tab`, `ui`,
> `watchlist`) export functions that call `evaluate` but have no `_resolve`/`_deps` yet.
> Note the existing-DI module `chart.js` still has un-threaded readers
> (`getVisibleRange`/`symbolInfo`/`symbolSearch`) that 0d/0f must also cover. Each gets a
> `makeResolver({ evaluate, evaluateAsync })` and an optional `{ _deps }` param threaded
> to its `_resolve(_deps)` call. (`index.js` is a barrel and `utils.js` has no `evaluate`
> calls, so neither needs DI — 18 modules in total call `evaluate` and get threaded.)

---

## 13. PHASE 1 — pool implementation (12 steps)

| # | Step | Deliverable |
|---|------|-------------|
| 1 | `TvError.js` | typed errors + `from()` |
| 2 | `CdpConnection.js` | serial queue, per-op timeout, bounded chain, `'disconnect'` |
| 3 | `cdpDiscovery.js` | `listChartTargets`, `attach`, `createNewTarget` (PUT→Cmd+T), `closeTarget` |
| 4 | `CdpPool.js` | full pool: `_pendingCount` on all creates (I-1), `_maybeGrowForWaiters` (I-2), `_failPendingSlot` untargeted (I-3), replay lock (I-4), `TARGET_GONE` (I-5), deadlined drain (I-6), `_createdTargetIds` (OPS-2), 5-retry `ensurePrimary` (CDP-3) |
| 5 | `withTab.js` | route dispatch, `connection` bypass (I-7), `TV_MCP_POOL=0` bypass (OPS-3) |
| 6 | `connection.js` wiring | `getPool`, `getReplaySession`, `ensurePrimarySlot`, `getLegacyDeps`, `resetPool` |
| 7 | Migrate **read tools** | wrap in `withTab(..., { route: 'headless' })` (or `'visible'` for user-facing reads) |
| 8 | Migrate **write tools** | wrap chart/draw/ui mutations in `withTab(..., { route: 'visible' })` |
| 9 | Migrate **replay** | route all `replay_*` through `ReplaySession`; `replay_run` passes held conn (I-7) |
| 10 | Startup | `server.js` calls `ensurePrimarySlot()`; register `drain()` on SIGINT/SIGTERM |
| 11 | Kill-switch test | `TV_MCP_POOL=0` end-to-end smoke; pool never instantiated (T-NEW-11) |
| 12 | Docs | update `CLAUDE.md` env table + routing section |

---

## 14. Test plan

All new tests are offline (`node:test`, injected mocks / fake timers). Live e2e
(`tests/e2e.test.js`, `tests/replay.test.js`) is unchanged and still gated on a running
TradingView.

### 14.1 Retained tests (21)

The existing `sanitization.test.js`, `pine_analyze.test.js`, and `cli.test.js` suites
(21 cases) must stay green throughout PHASE 0 — they prove the sanitizer relocation (0a)
and DI threading (0c/0d) introduced no regression. No change to their assertions.

### 14.2 New tests (T-NEW-1…T-NEW-12)

Each injects a **fake discovery** (`createNewTarget`/`listChartTargets`/`attach`/
`closeTarget` mocks) and **fake connections** (objects with stubbed `evaluate`/`run`/
`on`/`once`/`dispose`), and uses `node:test` mock timers where timeouts matter.

| Test | Asserts | Bug caught | Approach |
|------|---------|-----------|----------|
| **T-NEW-1** | Tab dies while a waiter is queued → `_maybeGrowForWaiters` creates a replacement and the waiter resolves (not timeout). | I-2 | Fill pool to maxTabs, queue 1 headless waiter, emit `'disconnect'` on an idle conn → assert the waiter resolves with a fresh conn from a new `createNewTarget` call. |
| **T-NEW-2** | Mixed waiter queue `[targeted-head, untargeted]`; a pending open fails → only the untargeted waiter is rejected, the targeted head untouched. | I-3 | Enqueue a `{wantId}` waiter then a headless waiter; make `createNewTarget` reject; assert head still pending, second rejected `CDP_DOWN`. |
| **T-NEW-3** | `acquire({tabId})` for a tab not in idle/used/pending → immediate `TvError(TARGET_GONE)`, no timeout. | I-5 | `acquire({tabId:'ghost'})` rejects synchronously; advance mock timer past tab-timeout and confirm it did NOT wait. |
| **T-NEW-4** | `drain(deadline)` with a stuck lease (op never returns) → force-closes after deadline, resolves. | I-6 | Lease a conn, never release; `drain(200)`; advance timer 200ms; assert resolves and `dispose()` was called on the stuck conn. |
| **T-NEW-5** | `replay_run` passes the held connection to inner start/autoplay/status/stop → no self-deadlock. | I-7 | Spy `pool.acquireReplay` called exactly once across `run()`; assert inner primitives receive the held-conn-bound `evaluate` (same identity). |
| **T-NEW-6** | Global replay lock: a concurrent `acquire('headless')` blocks until `releaseReplay()`. | I-4 | `acquireReplay()`, then `acquire('headless')` (pending). Assert unresolved; `releaseReplay(conn)`; assert it now resolves. |
| **T-NEW-7** | `createNewTarget`: PUT 200 → no Cmd+T; PUT 405 → Cmd+T fallback; Cmd+T yields the new target via before/after diff. | CDP-1 | Mock `fetch` for the PUT; spy `tabModule.newTab`. Three sub-cases in one test. |
| **T-NEW-8** | Double-release is idempotent; foreign-conn release is a no-op. | release safety | `release(conn)` twice → idle grows by 1, not 2; `release(strangerConn)` leaves all state unchanged. |
| **T-NEW-9** | Route placement: `'visible'`→primary (slot 0); `'headless'`→a non-primary tab; `{tabId}`→exact tab. | ARCH-1 | Seed primary + 2 workers; assert each route returns the expected conn id. |
| **T-NEW-10** | Per-op timeout: a hung `evaluate` rejects `CHART_TIMEOUT` after `evalTimeoutMs`; the tab still serves the next op. | M-5 | Stub `Runtime.evaluate` to never resolve once; mock-timer past 15s → `CHART_TIMEOUT`; then a normal op on the same conn resolves. |
| **T-NEW-11** | `TV_MCP_POOL=0` → all tool calls use `getLegacyDeps()`; `CdpPool` is never constructed. | OPS-3 | Set env, spy on `CdpPool` constructor; run a `withTab`-wrapped tool; assert constructor not invoked and legacy `evaluate` used. |
| **T-NEW-12** | Drain closes ONLY self-created target ids; the adopted primary is never closed. | OPS-2 | Adopt a primary (not in `_createdTargetIds`), grow 2 workers (added), `drain()`; assert `closeTarget` called for the 2 worker ids only, never the primary. |

### 14.3 Pool-internal unit tests (beyond the 12)

- **`_pendingCount` ceiling (I-1):** launch `maxTabs+2` concurrent `acquire('headless')`;
  assert at most `maxTabs` `createNewTarget` calls and `size` never exceeds `maxTabs` —
  the regression test for the original overcapacity bug.
- **Fair ordering:** two headless waiters; one tab frees; the older waiter wins.
- **Replay auto-expiry:** advance mock timer past `TV_MCP_REPLAY_EXPIRY_MS`; assert
  `stop()` ran and the global lock released so a blocked acquire proceeds.
- **`ensurePrimary` adopt vs create (CDP-3):** with one existing target → adopt it (no
  `createNewTarget`); with zero targets → create one with `selfCreated` but NOT tracked
  in `_createdTargetIds`.

### 14.4 Additional coverage (iteration-4 gaps)

These three stubs close coverage gaps surfaced in review: the `ensurePrimary`
failure→retry/backoff path (CDP-3), explicit strict-DI bypass coverage for the
un-threaded call sites (C6/T9), and the `release()` dead-while-leased re-grow branch
distinct from the idle-death path in T-NEW-1 (I-2b).

**T-CDP3-retry (ensurePrimary retry/backoff) — parent: CDP-3.**

```
T-CDP3-retry (ensurePrimary retry/backoff):
  Setup: inject _discover.listChartTargets to fail for attempts 0..3, succeed on attempt 4 returning a valid target.
  Inject fake setTimeoutFn. Advance fake clock through exponential delays (500ms, 1000ms, 2000ms, 4000ms).
  Assert: _doEnsurePrimary resolves on attempt 4 (createConnection called exactly once).
  Also: all 5 attempts fail → assert TvError(CDP_DOWN) is thrown.
  Also: two concurrent ensurePrimary() calls share one _primaryInitPromise → _doEnsurePrimary called exactly once.
```

**T-STRICT-DI (singleton bypass explicit coverage) — parent: C6/T9.**

```
T-STRICT-DI (singleton bypass explicit coverage):
  Setup: TV_MCP_STRICT_DI=1. Stub makeResolver to call through (not mock out).
  Explicitly call chart.getVisibleRange({}) with no _deps → assert throws [strict-di] error.
  Explicitly call chart.symbolInfo({}) with no _deps → assert throws [strict-di] error.
  For each of the 10 net-new modules (alerts, batch, capture, health, indicators, pane, stream, tab, ui, watchlist):
    call one representative exported function with no _deps → assert throws [strict-di] error.
  This explicitly exercises every un-threaded call site rather than relying on incidental coverage.
```

**T-NEW-1b (dead-while-leased re-grow) — parent: I-2b.**

```
T-NEW-1b (dead-while-leased re-grow):
  Distinct from T-NEW-1 (idle-death path). Setup: maxTabs=2, acquire 2 conns (both leased/in _used).
  Queue 1 headless waiter. Emit 'disconnect' on conn-A while it is still in _used (dead while leased).
  Call release(conn-A). Assert: _maybeGrowForWaiters fires, createNewTarget called once,
  the headless waiter resolves with the fresh conn (not via idle, but via new creation).
  This covers the release() branch at §7.6 (line ~826), distinct from the _wireDisconnect branch in T-NEW-1.
```

---

## 15. Environment variables

| Var | Default | Effect |
|-----|---------|--------|
| `TV_MCP_MAX_TABS` | `3` | Max concurrent tabs (incl. primary). `1` = effectively serial but still pooled. Min clamped to 1. |
| `TV_MCP_TAB_TIMEOUT_MS` | `20000` | How long `acquire()` waits for a free/grown tab before `POOL_EXHAUSTED`. |
| `TV_MCP_EVAL_TIMEOUT_MS` | `15000` | Per-op `evaluate()` timeout inside `CdpConnection.run()` (M-5). |
| `TV_MCP_DRAIN_TIMEOUT_MS` | `8000` | `drain()` deadline before force-closing leased tabs (I-6). |
| `TV_MCP_REPLAY_EXPIRY_MS` | `600000` | Idle auto-expiry for a forgotten replay session (releases the global lock). |
| `TV_MCP_STRICT_DI` | _(unset)_ | `=1` → `makeResolver` throws on missing `_deps` instead of singleton fallback. CI gate (PHASE 0f). |
| `TV_MCP_POOL` | _(unset)_ | `=0` → bypass the pool; use legacy `getClient()` singleton. Rollback lever (OPS-3). |
| `TV_MCP_CDP_HOST` / `TV_MCP_CDP_PORT` | `localhost` / `9222` | CDP endpoint (implicit today; now explicit for discovery). |

Existing flags (`TV_MCP_NETWORK`, `TV_MCP_WS_FRAMES`, `TV_MCP_EXTENDED`) are unchanged
and orthogonal to the pool.

---

## 16. Backwards compatibility

- **Existing offline tests pass unchanged.** `sanitization.test.js` keeps importing
  `safeString`/`requireFinite` (re-exported from `connection.js` during transition);
  `pine_analyze.test.js` and `cli.test.js` don't touch the connection layer.
- **`TV_MCP_POOL=0` is a complete, code-free rollback.** Tool wrappers detect it in
  `withTab` and call `getLegacyDeps()`; `getPool()` is never invoked, so the new code
  paths are inert. The singleton in `connection.js` is retained for one release.
- **CLI unaffected.** `src/cli/*` runs a single command and exits; it uses
  `getClient()`/`evaluate()` directly and never enters the pool, regardless of
  `TV_MCP_POOL`. No CLI command needs a route.
- **Default behavior is conservative.** `TV_MCP_MAX_TABS=3` means at most two extra
  worker tabs appear in the user's window, and they are closed on clean shutdown (OPS-2).
  Setting `TV_MCP_MAX_TABS=1` keeps a single tab (the adopted primary) while still
  exercising the pool's queueing — a safe intermediate during cutover.
- **Replay semantics preserved.** Replay still runs on the user's visible chart; the
  global lock only changes *when* concurrent ops run (they block, then proceed after
  `replay_stop`) — no observable change for single-threaded replay use.

---

## Appendix A — file inventory

| File | New? | Purpose |
|------|------|---------|
| `src/core/TvError.js` | new | typed errors |
| `src/core/_safe.js` | new | sanitizers (moved from connection.js) |
| `src/core/_resolve.js` | new | `makeResolver` |
| `src/core/CdpConnection.js` | new | per-tab connection + serial queue + timeout |
| `src/core/cdpDiscovery.js` | new | target discovery + tab creation/cleanup |
| `src/core/CdpPool.js` | new | the pool |
| `src/core/replaySession.js` | new | replay global-lock session |
| `src/core/withTab.js` | new | lease helper + route dispatch + kill switch |
| `src/connection.js` | edit | re-export shims + pool accessors; keep singleton |
| `src/wait.js` | edit | accept optional `_deps` ({ evaluate }) |
| `src/core/*.js` (×18) | edit | thread `_deps` via `makeResolver` (8 existing-DI + 10 net-new; `index.js`/`utils.js` excluded — no `evaluate` calls) |
| `src/tools/*.js` | edit | wrap calls in `withTab({ route })`, surface `code`/`retryable` |
| `tests/pool.test.js` | new | T-NEW-1…12 + internal unit tests |

---

## Appendix B — issue → fix traceability

| Issue | Where fixed | Test |
|-------|-------------|------|
| I-1 overcapacity | §7.2 `ensurePrimary` + §7.4 `_growHeadless` both wrap `_pendingCount`; `size` includes it | 14.3 `_pendingCount` ceiling |
| I-2 waiter starvation | §7.3/§7.6 `_maybeGrowForWaiters` on idle-death and dead-release | T-NEW-1 |
| I-3 wrong-waiter reject | §7.5 `_failPendingSlot` selects first untargeted | T-NEW-2 |
| I-4 replay session-global | §7.7 global `_replayLock`; §8 `ReplaySession` | T-NEW-6 |
| I-5 dead pinned hang | §7.4 `_acquirePinned` fast-fails `TARGET_GONE` | T-NEW-3 |
| I-6 drain no deadline | §7.8 `drain(deadlineMs)` polls 50ms, force-closes | T-NEW-4 |
| I-7 replay_run non-re-entrant | §8 `run()` passes held-conn `_deps`; §9 `withTab` `connection` bypass | T-NEW-5 |
| M-5 unbounded chain / no timeout | §5 `run()` bounded chain + `_withTimeout` | T-NEW-10 |
| ARCH-1 routing axis | §1.2 + §7.4 visible/headless/tabId | T-NEW-9 |
| ARCH-2 PHASE 0 scope | §12 six-step plan | 14.1 retained suites |
| CDP-1 /json/new | §6 `createNewTarget` PUT→Cmd+T | T-NEW-7 |
| CDP-2 real readiness | §6 uses `wait.js` `waitForChartReady(conn)` | covered by e2e |
| CDP-3 ensurePrimary retry | §7.2 5-retry backoff | 14.3 adopt/create |
| OPS-1 error flattening | §2 `TvError`; §11 wrapper surfaces `code`/`retryable` | all new tests |
| OPS-2 tab leak | §7.8 closes `_createdTargetIds` only | T-NEW-12 |
| OPS-3 kill switch | §9/§10 `TV_MCP_POOL=0` bypass | T-NEW-11 |
| OPS-4 double-connect | §6 readiness on final conn, no probe | covered by T-NEW-7 |

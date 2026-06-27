# TradingView MCP — CDP Dependency & Observability Report

**Date:** 2026-06-27
**Scope:** Why this project requires TradingView Desktop in debug mode, whether a normal browser could substitute, and what observability/diagnostics are available.

---

## 1. Why `--remote-debugging-port=9222` is a hard prerequisite

TradingView Desktop is an **Electron app** (a Chromium renderer wrapping the same web charting platform as tradingview.com). This project is **not a scraper** — it attaches a Chrome DevTools Protocol (CDP) debugger to the live renderer and executes JavaScript inside TradingView's own page context, calling TradingView's private in-page JS objects directly.

Chromium only exposes a CDP endpoint (HTTP discovery + per-target WebSocket) when launched with `--remote-debugging-port`. Without it there is nothing to attach to — hence the hard requirement.

### The mechanism (`src/connection.js`)

- **Single dependency:** `chrome-remote-interface@^0.33.2` (`package.json:30`). No Puppeteer/Playwright. Module-level singleton `client` (`connection.js:3`, `getClient()` `:50`).
- **Target discovery** (`findChartTarget`, `connection.js:90–97`): HTTP-polls the discovery endpoint and matches by URL:
  ```js
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);   // localhost:9222
  const targets = await resp.json();
  return targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
      || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url)) || null;
  ```
- **Attach** (`connect`, `:64–88`): `CDP({ host, port, target: target.id })`, then enables `Runtime.enable()`, `Page.enable()`, `DOM.enable()` (`:76–78`). 5× retry w/ backoff.
- **`evaluate(expr)`** (`:106–121`): the heart of the system — `Runtime.evaluate({ expression, returnByValue: true, awaitPromise: false })`, returns `result.result.value`, throws on `exceptionDetails`. `evaluateAsync` (`:123–125`) is the same with `awaitPromise: true` for Promise-returning TradingView calls.
- Transport is the per-target CDP **WebSocket** (`webSocketDebuggerUrl`), which only exists with the debug flag.

### `KNOWN_PATHS` — TradingView's private JS API (`connection.js:11–27`)

Internal, undocumented `window` object paths discovered by live probing:
```js
chartApi:        'window.TradingViewApi._activeChartWidgetWV.value()',
chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
replayApi:       'window.TradingViewApi._replayApi',
alertService:    'window.TradingViewApi._alertService',
mainSeriesBars:  'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
```
`_activeChartWidgetWV` is a **WatchedValue** (`.value()` unwraps it). These are live JS objects — closures, methods, WatchedValues — **not DOM**. The only way to read or invoke them is to run code *inside* the renderer via `Runtime.evaluate`. All 68 tools funnel through `connection.evaluate()` → `Runtime.evaluate` → TradingView's private `window.TradingViewApi.*`.

### Launch (`src/core/health.js:162–251`, `scripts/launch_tv_debug_*`)

`tv_launch` resolves the platform binary (`/Applications/TradingView.app/Contents/MacOS/TradingView`), optionally `pkill`s the running app, then `spawn(tvPath, ['--remote-debugging-port=' + cdpPort], { detached: true })` (`:222`), and polls `http://localhost:PORT/json/version` until ready.

**Conclusion:** the project is fundamentally a **CDP remote-control bridge** that depends on executing JS in TradingView's renderer. That channel exists only with the debug port open.

---

## 2. Could a normal browser (Chrome + web app) replace Desktop?

**Verdict: technically viable, but it trades Desktop's self-managed auth and anti-bot immunity for a serious Cloudflare risk. The observability upside is real but obtainable a cheaper way (see §4).**

| Question | Finding |
|---|---|
| Same `window.TradingViewApi`? | **Almost certainly yes.** Desktop is an Electron shell loading the same charting bundle as tradingview.com. The `KNOWN_PATHS` internals should be identically named on web. Risk: private unversioned globals could drift between web/desktop builds at a given moment. |
| Authentication | **Biggest regression.** Desktop self-manages login and persists sessions; you just attach. Driving Chrome means **you own the tradingview.com session** — cookies/login in a persistent profile, behind Cloudflare, with 2FA/device-verification/expiry now your failure modes. |
| CDP surface Chrome vs Electron | **Effectively identical** — both Chromium, same protocol on port 9222. Minor differences: Electron exposes multiple targets (main vs renderer); plain Chrome gives cleaner per-tab targets and a full DevTools UI. |
| Playwright/Puppeteer | `chromium.connectOverCDP()` attaches to **either** Electron or Chrome. Over raw `chrome-remote-interface` it adds network interception/mocking, request/response + console + page-error capture, **tracing** (snapshots), video, screenshots, auto-waiting. **Key:** you can attach Playwright to the *existing Electron app* — observability gain does **not** require switching to web. |
| Anti-bot / Cloudflare | **Decisive risk.** tradingview.com sits behind Cloudflare, which (as of 2025) targets Selenium/Puppeteer/Playwright via TLS/canvas/WebGL fingerprints, `navigator.webdriver`, behavioral + IP signals; stealth plugins are unreliable. The **signed Desktop client avoids this entirely.** Attaching CDP to an already-logged-in human-launched Chrome profile is lower risk than headless, but still one Turnstile challenge away from a stuck session. |
| Feature parity | Charting, indicators, **Pine editor, alerts, saved layouts, replay** are identical on web. Desktop-only items (multi-monitor, cross-tab sync, state restoration, system theme) are workflow conveniences, not API features. Functional parity for the 68 tools is essentially complete. |

**Recommendation:** keep Desktop as the target; layer **Playwright `connectOverCDP()`** (or richer CDP event subscriptions) on the *same port 9222* to unlock network/console/trace capture. Treat browser-driven web as a fallback/portability path — and only with a persistent, human-logged-in (non-headless) Chrome profile.

---

## 3. What the project uses today vs. observability gaps

The project uses CDP as a **synchronous JS-eval + screenshot bridge**. It is **entirely pull-based — zero CDP event subscriptions.**

**USED:**
1. `Runtime.enable` + `Runtime.evaluate` (`connection.js:54,76,108`) — the workhorse for every feature.
2. `Page.enable` + `Page.captureScreenshot` (`core/capture.js:63`, `core/batch.js:41`) — screenshots only.
3. `DOM.enable` (`connection.js:78`) — **enabled but unused**; DOM is queried via `document.querySelectorAll` inside `Runtime.evaluate`, not the CDP DOM domain.
4. `Target.activateTarget` via HTTP REST `/json/activate/<id>` (`tab.js:98–100`), not the CDP command.

**NOT USED — observability gaps:**
- **No CDP event subscriptions at all.** No `client.on(...)` for any CDP event. Architecture never reacts to pushed events.
- **No console/log capture via CDP.** `pine_get_console` (`core/pine.js:379–427`) **DOM-scrapes** `[class*="consoleRow"]` and regex-parses visible text — misses anything not rendered in the panel.
- **No `Runtime.exceptionThrown`** — uncaught renderer exceptions are invisible.
- **No `Network` domain.** Biggest gap: **TradingView streams market data over WebSockets and none of it is inspected.** All "streaming" (`core/stream.js:15–56`) is **poll-and-diff** — re-runs `Runtime.evaluate` every 300–2000ms and dedups by `JSON.stringify` hash.
- **No `Performance`, `Profiler`, `Debugger`, `Tracing`, `Log` domains** — no metrics, no tracing.

---

## 4. Observability you can get from TradingView Desktop

### A. Full DevTools window over CDP — works today, zero code
With the debug port active, from a real Chrome:
- **Discover:** `GET http://localhost:9222/json/list` → targets with `id`, `url`, `webSocketDebuggerUrl`, `devtoolsFrontendUrl`.
- **Attach:** `chrome://inspect` → Configure → add `localhost:9222` → the TradingView renderer appears under Remote Target → **inspect** → full DevTools (Elements, Console, Network, Performance, Sources, Memory, Application) on the live renderer.
- **Direct URL:** `devtools://devtools/bundled/inspector.html?ws=localhost:9222/devtools/page/<TARGET_ID>`. On Chromium M113+ a host check can reject `localhost` — use `127.0.0.1` or add `--remote-allow-origins=*` to launch flags.
- Multiple clients can attach simultaneously, so DevTools + the MCP can both be connected.

### B. High-value CDP domains to subscribe to (the project already has `chrome-remote-interface`)
- **`Runtime.consoleAPICalled`** — every `console.*` in the renderer (Runtime already enabled — one listener away).
- **`Runtime.exceptionThrown`** — uncaught renderer exceptions w/ stack traces.
- **`Log.entryAdded`** (`Log.enable()`) — network failures, CSP/security, deprecations.
- **`Network` domain** (`Network.enable()`) — the big one: `requestWillBeSent`/`responseReceived` for REST, and **`Network.webSocketFrameReceived`/`webSocketFrameSent`** to observe the raw realtime quote/bar feed instead of polling the DOM.
- **`Performance.getMetrics`** — JS heap, DOM node count, layout counts; detect chart bloat/leaks over long sessions.

### C. TradingView-native debug
- **Charting-library debug mode:** call `widget.setDebugMode(true)` via `evaluate()` at runtime → detailed datafeed/processing logs to the renderer console → capture via `Runtime.consoleAPICalled`. Cleanest TradingView-native signal.

### D. Electron log files & crash dumps (macOS)
- **App logs:** `~/Library/Logs/<AppName>/` (main process; `main.log` if it bundles `electron-log`).
- **Crash dumps (Crashpad):** `~/Library/Application Support/<AppName>/Crashpad/` (`completed/`, `new/`, `pending/`, `.dmp`).
- **App data / localStorage / IndexedDB:** `~/Library/Application Support/<AppName>/`.
- **Verbose logging flags/env:** `ELECTRON_ENABLE_LOGGING=1`, `--enable-logging[=stderr]`, `--v=1`/`--vmodule=`, `ELECTRON_ENABLE_STACK_DUMPING=1` — add alongside `--remote-debugging-port=9222` in `scripts/launch_tv_debug_*`.

### E. macOS unified logs
```
log stream --predicate 'process == "TradingView"' --level debug --style compact
log show   --predicate 'process == "TradingView"' --last 1h
```
Captures native/Electron crashes and OS signals that never reach the JS console.

### F. Recommended setup (best diagnostics while MCP drives) — they don't conflict
1. **In `connect()` (`src/connection.js:76–78`)** enable + subscribe to observability domains and ring-buffer to a file (exposed as a new `data_get_logs` tool):
   ```js
   await client.Network.enable();
   await client.Log.enable();
   await client.Performance.enable();
   client.Runtime.consoleAPICalled(e => log('console', e));
   client.Runtime.exceptionThrown(e => log('exception', e));
   client.Log.entryAdded(e => log('browserlog', e));
   client.Network.webSocketFrameReceived(e => log('ws', e.response.payloadData));
   ```
   Optionally flip `widget.setDebugMode(true)` via `evaluate()` to enrich output.
2. **Attach a real Chrome DevTools window** in parallel via `chrome://inspect` for interactive Network/WS/Performance/Memory depth.
3. **Launch verbose** (`ELECTRON_ENABLE_LOGGING=1 --enable-logging --v=1 --remote-debugging-port=9222`) and keep a `log stream` running for native/crash coverage.

This trio — CDP event subscriptions (in-app data) + DevTools frontend (interactive depth) + unified-log/Electron files (native/crash) — covers logs, console, network/WS, performance, exceptions, and crashes.

---

## 5. Bottom line

- **Why the debug port is required:** the tool runs JS inside TradingView's renderer to call private `window.TradingViewApi.*` objects; that only works when Chromium opens its remote-debugging port.
- **Browser/web swap:** viable but loses Desktop's self-managed auth and Cloudflare immunity. Not worth it *just* for observability.
- **Better observability, keep Desktop:** the same port 9222 already exposes everything you need. Subscribe to `Network`/`Console`/`Log`/`Performance`/`Runtime.exceptionThrown` CDP events (and/or attach Playwright `connectOverCDP()` or a Chrome DevTools window) on the existing Electron app. The single biggest win is **WebSocket frame inspection** (`Network.webSocketFrameReceived`) to observe TradingView's raw market-data stream instead of polling the DOM.

### Key anchors
`src/connection.js:64–125` (connect/evaluate), `:90–97` (target discovery), `:11–27` (KNOWN_PATHS), `:76–78` (where to add domain enables); `src/core/stream.js:15–56` (polling); `src/core/pine.js:379–427` (DOM-scrape console); `src/core/health.js:162–251` (launch); `package.json:30` (chrome-remote-interface).

import CDP from 'chrome-remote-interface';
import { safeString, requireFinite } from './core/_safe.js';

let client = null;
let _diagnosticsSink = null;

export function setDiagnosticsSink(fn) {
  _diagnosticsSink = fn;
  if (client && fn) fn(client);
}

let targetInfo = null;
const CDP_HOST = 'localhost';
const CDP_PORT = 9222;
const MAX_RETRIES = 5;
const BASE_DELAY = 500;

// Known direct API paths discovered via live probing (see PROBE_RESULTS.md)
const KNOWN_PATHS = {
  chartApi: 'window.TradingViewApi._activeChartWidgetWV.value()',
  chartWidgetCollection: 'window.TradingViewApi._chartWidgetCollection',
  bottomWidgetBar: 'window.TradingView.bottomWidgetBar',
  replayApi: 'window.TradingViewApi._replayApi',
  alertService: 'window.TradingViewApi._alertService',
  chartApiInstance: 'window.ChartApiInstance',
  mainSeriesBars: 'window.TradingViewApi._activeChartWidgetWV.value()._chartWidget.model().mainSeries().bars()',
  // Phase 1: Strategy data — model().dataSources() → find strategy → .performance().value(), .ordersData(), .reportData()
  strategyStudy: 'chart._chartWidget.model().model().dataSources()',
  // Phase 2: Layouts — getSavedCharts(cb), loadChartFromServer(id)
  layoutManager: 'window.TradingViewApi.getSavedCharts',
  // Phase 5: Symbol search — searchSymbols(query) returns Promise
  symbolSearchApi: 'window.TradingViewApi.searchSymbols',
  // Phase 6: Pine scripts — REST API at pine-facade.tradingview.com/pine-facade/list/?filter=saved
  pineFacadeApi: 'https://pine-facade.tradingview.com/pine-facade',
};

export { KNOWN_PATHS };

// Re-exported from ./core/_safe.js for backwards compatibility.
// Definitions now live in src/core/_safe.js (see Phase 0a migration).
export { safeString, requireFinite } from './core/_safe.js';

export async function getClient() {
  if (client) {
    try {
      // Quick liveness check
      await client.Runtime.evaluate({ expression: '1', returnByValue: true });
      return client;
    } catch {
      client = null;
      targetInfo = null;
    }
  }
  return connect();
}

async function enableSafe(c, domain) {
  if (!c[domain]) return;
  try { await c[domain].enable(); } catch (_) {}
}

export async function connect() {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const target = await findChartTarget();
      if (!target) {
        throw new Error('No TradingView chart target found. Is TradingView open with a chart?');
      }
      targetInfo = target;
      client = await CDP({ host: CDP_HOST, port: CDP_PORT, target: target.id });

      // Enable required domains
      await client.Runtime.enable();
      await client.Page.enable();
      await client.DOM.enable();
      await enableSafe(client, 'Log');
      if (process.env.TV_MCP_NETWORK === '1') {
        await enableSafe(client, 'Network');
      }

      if (_diagnosticsSink) _diagnosticsSink(client);

      return client;
    } catch (err) {
      lastError = err;
      const delay = Math.min(BASE_DELAY * Math.pow(2, attempt), 30000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error(`CDP connection failed after ${MAX_RETRIES} attempts: ${lastError?.message}`);
}

async function findChartTarget() {
  const resp = await fetch(`http://${CDP_HOST}:${CDP_PORT}/json/list`);
  const targets = await resp.json();
  // Prefer targets with tradingview.com/chart in the URL
  return targets.find(t => t.type === 'page' && /tradingview\.com\/chart/i.test(t.url))
    || targets.find(t => t.type === 'page' && /tradingview/i.test(t.url))
    || null;
}

export async function getTargetInfo() {
  if (!targetInfo) {
    await getClient();
  }
  return targetInfo;
}

export async function evaluate(expression, opts = {}) {
  const c = await getClient();
  const result = await c.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: opts.awaitPromise ?? false,
    ...opts,
  });
  if (result.exceptionDetails) {
    const msg = result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'Unknown evaluation error';
    throw new Error(`JS evaluation error: ${msg}`);
  }
  return result.result?.value;
}

export async function evaluateAsync(expression) {
  return evaluate(expression, { awaitPromise: true });
}

export async function disconnect() {
  if (client) {
    try { await client.close(); } catch {}
    client = null;
    targetInfo = null;
  }
}

// --- Direct API path helpers ---
// Each returns the STRING expression path after verifying it exists.
// Callers use the returned string in their own evaluate() calls.

async function verifyAndReturn(path, name) {
  const exists = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
  if (!exists) {
    throw new Error(`${name} not available at ${path}`);
  }
  return path;
}

export async function getChartApi() {
  return verifyAndReturn(KNOWN_PATHS.chartApi, 'Chart API');
}

export async function getChartCollection() {
  return verifyAndReturn(KNOWN_PATHS.chartWidgetCollection, 'Chart Widget Collection');
}

export async function getBottomBar() {
  return verifyAndReturn(KNOWN_PATHS.bottomWidgetBar, 'Bottom Widget Bar');
}

export async function getReplayApi() {
  return verifyAndReturn(KNOWN_PATHS.replayApi, 'Replay API');
}

export async function getMainSeriesBars() {
  return verifyAndReturn(KNOWN_PATHS.mainSeriesBars, 'Main Series Bars');
}

// --- CDP connection pool (Phase 1) ---
// Imports are top-level but only DEREFERENCED inside functions, so the
// connection.js ↔ CdpPool ↔ cdpDiscovery ↔ wait ↔ _resolve cycle stays safe
// (ESM live bindings; nothing in this block runs at module-eval time).
import { CdpPool } from './core/CdpPool.js';
import { ReplaySession } from './core/replaySession.js';
import * as tabModule from './core/tab.js';

let _pool = null;
let _replaySession = null;

/** OPS-3 kill switch: TV_MCP_POOL=0 → bypass the pool, use the legacy singleton. */
export function isPoolDisabled() {
  return process.env.TV_MCP_POOL === '0';
}

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

/** Server startup hook: ensure the visible/primary tab exists before serving. */
export async function ensurePrimarySlot() {
  if (isPoolDisabled()) { await getClient(); return; }
  await getPool().ensurePrimary();
}

/** Legacy singleton deps used when the pool is disabled (withTab bypass). */
export function getLegacyDeps() {
  return { evaluate, evaluateAsync };
}

/** Test/shutdown helper: drain + drop the pool so the next getPool() rebuilds it. */
export async function resetPool() {
  if (_pool) { try { await _pool.drain(0); } catch {} }
  _pool = null;
  _replaySession = null;
}

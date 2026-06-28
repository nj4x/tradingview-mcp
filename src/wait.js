import { evaluate as _evaluate, KNOWN_PATHS } from './connection.js';
import { makeResolver } from './core/_resolve.js';

const _resolve = makeResolver(['evaluate']);

const DEFAULT_TIMEOUT = 10000;
const POLL_INTERVAL = 200;
const FRESH_TIMEOUT_MS = Number(process.env.TV_MCP_FRESH_TIMEOUT_MS || 8000);

export async function waitForChartReady(expectedSymbol = null, expectedTf = null, timeout = DEFAULT_TIMEOUT, _deps = {}) {
  const { evaluate } = _resolve(_deps);
  const start = Date.now();
  let lastBarCount = -1;
  let stableCount = 0;

  while (Date.now() - start < timeout) {
    const state = await evaluate(`
      (function() {
        // Check for loading spinner
        var spinner = document.querySelector('[class*="loader"]')
          || document.querySelector('[class*="loading"]')
          || document.querySelector('[data-name="loading"]');
        var isLoading = spinner && spinner.offsetParent !== null;

        // Try to get bar count from data window or chart
        var barCount = -1;
        try {
          var bars = document.querySelectorAll('[class*="bar"]');
          barCount = bars.length;
        } catch {}

        // Get current symbol from header
        var symbolEl = document.querySelector('[data-name="legend-source-title"]')
          || document.querySelector('[class*="title"] [class*="apply-common-tooltip"]');
        var currentSymbol = symbolEl ? symbolEl.textContent.trim() : '';

        return { isLoading: !!isLoading, barCount: barCount, currentSymbol: currentSymbol };
      })()
    `);

    if (!state) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Not ready if still loading
    if (state.isLoading) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check symbol match if expected
    if (expectedSymbol && state.currentSymbol && !state.currentSymbol.toUpperCase().includes(expectedSymbol.toUpperCase())) {
      stableCount = 0;
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
      continue;
    }

    // Check bar count stability
    if (state.barCount === lastBarCount && state.barCount > 0) {
      stableCount++;
    } else {
      stableCount = 0;
    }
    lastBarCount = state.barCount;

    if (stableCount >= 2) {
      return true;
    }

    await new Promise(r => setTimeout(r, POLL_INTERVAL));
  }

  // Timeout — return true anyway, caller should verify
  return false;
}

// ── Bar freshness gate ──────────────────────────────────────────────────────

/** Resolution string → seconds per bar. Mirrors scrollToDate (chart.js); tolerant of D/1D forms. */
function _resSeconds(res) {
  const r = String(res);
  if (r === 'D' || r === '1D') return 86400;
  if (r === 'W' || r === '1W') return 604800;
  if (r === 'M' || r === '1M') return 2592000;
  const mins = parseInt(r, 10);
  return Number.isNaN(mins) ? 60 : mins * 60;
}

/** Normalize a resolution for identity comparison: uppercase, strip a leading "1" on D/W/M. */
function _normRes(res) {
  const r = String(res ?? '').toUpperCase();
  if (r === '1D') return 'D';
  if (r === '1W') return 'W';
  if (r === '1M') return 'M';
  return r;
}

/** Case-insensitive, exchange-prefix-tolerant symbol equality (e.g. SOLUSD ~ BINANCE:SOLUSD). */
function _symbolMatch(requested, actual) {
  const a = String(requested ?? '').toUpperCase();
  const b = String(actual ?? '').toUpperCase();
  if (!a || !b) return false;
  const ab = a.includes(':') ? a.split(':').pop() : a;
  const bb = b.includes(':') ? b.split(':').pop() : b;
  return a === b || ab === bb;
}

/** Bar times may be seconds or ms (charting-library internal). Normalize to seconds. */
function _toSeconds(t) {
  return typeof t === 'number' && t > 1e12 ? t / 1000 : t;
}

/**
 * Wait until the chart's main series holds the requested symbol/resolution AND is current.
 *
 * Accepts a poll only when ALL hold:
 *  1. series present & non-empty
 *  2. identity: api.symbol()/api.resolution() match the request (normalized)
 *  3. stabilized: (lastTime, size) unchanged across `stablePolls` consecutive ok polls
 *  4. recency (only when requireRecency): nowSec - lastTime <= ~3× the resolution interval
 *
 * Never throws — returns { fresh, ... } and lets the caller decide. The probe is a static
 * string; requested symbol/resolution are compared against probe OUTPUT (no interpolation).
 *
 * @param {{ symbol?:string, resolution?:string, requireRecency?:boolean, nowSec?:number,
 *           timeout?:number, pollMs?:number, stablePolls?:number, _deps?:object }} opts
 */
export async function waitForBarsFresh({
  symbol, resolution, requireRecency = false, nowSec,
  timeout = FRESH_TIMEOUT_MS, pollMs = POLL_INTERVAL, stablePolls = 2, _deps = {},
} = {}) {
  const { evaluate } = _resolve(_deps);
  const start = Date.now();
  const now = typeof nowSec === 'number' ? nowSec : Math.floor(Date.now() / 1000);
  const maxLag = _resSeconds(resolution) * 3;

  let prevKey = null;
  let stable = 0;
  let last = null;

  const probe = `
    (function () {
      try {
        var api  = ${KNOWN_PATHS.chartApi};
        var bars = ${KNOWN_PATHS.mainSeriesBars};
        if (!bars || typeof bars.lastIndex !== 'function') return { ok:false, reason:'no-series' };
        var size = bars.size();
        if (!size) return { ok:false, reason:'empty' };
        var lastBar = bars.valueAt(bars.lastIndex());
        return { ok:true, symbol:api.symbol(), resolution:api.resolution(),
                 lastTime: lastBar ? lastBar[0] : null, size: size };
      } catch (e) { return { ok:false, reason:'err', message:String(e) }; }
    })()
  `;

  while (Date.now() - start < timeout) {
    let state;
    try { state = await evaluate(probe); } catch { state = null; }

    if (!state || !state.ok) {
      stable = 0; prevKey = null;
      await new Promise(r => setTimeout(r, pollMs));
      continue;
    }
    last = state;

    // Identity: must be on the requested symbol/resolution (when provided).
    const symOk = symbol ? _symbolMatch(symbol, state.symbol) : true;
    const resOk = (resolution !== undefined && resolution !== null)
      ? _normRes(resolution) === _normRes(state.resolution) : true;
    if (!symOk || !resOk) {
      stable = 0; prevKey = null;
      await new Promise(r => setTimeout(r, pollMs));
      continue;
    }

    // Recency (live-tradable markets only): the last bar must be reasonably current.
    if (requireRecency && state.lastTime != null) {
      const lagOk = (now - _toSeconds(state.lastTime)) <= maxLag;
      if (!lagOk) {
        stable = 0; prevKey = null;
        await new Promise(r => setTimeout(r, pollMs));
        continue;
      }
    }

    // Stabilization: (lastTime, size) unchanged across consecutive ok polls.
    const key = `${state.lastTime}|${state.size}`;
    if (key === prevKey) stable++; else { stable = 1; prevKey = key; }

    if (stable >= stablePolls) {
      return {
        fresh: true,
        lastTime: state.lastTime,
        size: state.size,
        symbol: state.symbol,
        resolution: state.resolution,
        waitedMs: Date.now() - start,
      };
    }

    await new Promise(r => setTimeout(r, pollMs));
  }

  return {
    fresh: false,
    timedOut: true,
    reason: last ? 'unstable-or-stale' : 'no-series',
    lastTime: last ? last.lastTime : null,
    size: last ? last.size : null,
    symbol: last ? last.symbol : null,
    resolution: last ? last.resolution : null,
    waitedMs: Date.now() - start,
  };
}

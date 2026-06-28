// src/core/_resolve.js
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync } from '../connection.js';

const _warned = new Set();

function warnOnce(name) {
  if (_warned.has(name)) return;
  _warned.add(name);
  process.stderr.write(`[tradingview-mcp] singleton fallback for "${name}" — thread _deps or set TV_MCP_POOL=0\n`);
}

const SINGLETON = { evaluate: _evaluate, evaluateAsync: _evaluateAsync };

/**
 * makeResolver(names, extras?) → _resolve(deps)
 *
 * names: string[] — pool-governed keys resolved from deps, falling back to the
 *   evaluate/evaluateAsync singleton (e.g. ['evaluate', 'evaluateAsync']).
 * extras: { [name]: fallback } — additional deps a module needs (e.g.
 *   { getChartApi, waitForChartReady, fetch }). Each falls back to the provided
 *   value when not injected. Extras are NOT pool-governed and never throw under
 *   strict DI — they're plain non-evaluate helpers.
 *
 * _resolve(deps) returns an object with a lazy getter per key. A key is only
 * resolved when accessed, so a function that destructures just `{ evaluate }` never
 * triggers resolution of an unused `evaluateAsync`. For pool-governed names,
 * TV_MCP_STRICT_DI=1 makes the singleton fallback throw on access (PHASE 0f gate).
 *
 * Lazy access matters: eager resolution would false-positive under strict DI whenever
 * a resolver lists more names than a given call path consumes.
 */
export function makeResolver(names, extras = {}) {
  return function _resolve(deps) {
    const out = {};
    for (const name of names) {
      Object.defineProperty(out, name, {
        enumerable: true,
        get() {
          if (deps && typeof deps[name] === 'function') return deps[name];
          if (process.env.TV_MCP_STRICT_DI === '1') {
            throw new Error(`[strict-di] missing _deps.${name} — use withTab to inject a tab connection`);
          }
          warnOnce(name);
          return SINGLETON[name];
        },
      });
    }
    for (const [name, fallback] of Object.entries(extras)) {
      Object.defineProperty(out, name, {
        enumerable: true,
        get() {
          if (deps && typeof deps[name] === 'function') return deps[name];
          return fallback;
        },
      });
    }
    return out;
  };
}

export function _resetWarnings() { _warned.clear(); }

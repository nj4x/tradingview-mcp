/**
 * Core options-discovery logic.
 *
 * options_search (A3) finds options contracts for an underlying symbol.
 *
 * Two-tier strategy:
 *   1. Primary  — TradingView's public symbol-search REST API (no auth):
 *                 https://symbol-search.tradingview.com/symbol_search/v3/?search_type=option&text=...
 *      Runs in the Node process via `fetch`. underlying is encoded with
 *      URLSearchParams so it cannot break out of the query string.
 *   2. Fallback — when REST returns empty / errors, run
 *                 window.TradingViewApi.searchSymbols({ text, type:'option' })
 *      inside the renderer (authenticated session → richer catalogue).
 *      underlying is passed through safeString() before interpolation.
 *
 * Client-side filtering (strike / expiry / contract_type) is applied to whichever
 * tier produced results. Results are deduplicated by symbol, sorted by strike,
 * and capped at `limit` (default 50).
 */
import { evaluateAsync as _evaluateAsync, safeString } from '../connection.js';

function _resolve(deps) {
  return {
    fetch: deps?.fetch || globalThis.fetch,
    evaluateAsync: deps?.evaluateAsync || _evaluateAsync,
  };
}

const strip = s => (s || '').replace(/<\/?em>/g, '');

/** Parse a strike out of a raw symbol-search record (several shapes in the wild). */
function parseStrike(r) {
  for (const v of [r.strike, r.strikePrice]) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  // Fall back to parsing the OCC-style symbol tail (e.g. AAPL250117C00150000 → 150)
  const sym = strip(r.symbol || '');
  const m = sym.match(/[CP](\d{6,8})$/);
  if (m) {
    const n = Number(m[1]) / 1000;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** Normalise expiry to a YYYY-MM-DD string when possible. */
function parseExpiry(r) {
  const raw = r.expiration || r.expiry || r.expiration_date || null;
  if (!raw) return null;
  // Numeric unix (s or ms) or YYYYMMDD integer
  const n = Number(raw);
  if (Number.isFinite(n) && String(raw).length >= 8) {
    if (String(raw).length === 8) {
      // YYYYMMDD
      const s = String(raw);
      return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
    }
    const ms = String(raw).length <= 10 ? n * 1000 : n;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(raw);
}

/** call|put from any of the common fields. */
function parseContractType(r) {
  const raw = (r.option_type || r.contract_type || r.optionType || r.right || '').toString().toLowerCase();
  if (raw.startsWith('c')) return 'call';
  if (raw.startsWith('p')) return 'put';
  // Fall back to OCC symbol letter
  const sym = strip(r.symbol || '');
  const m = sym.match(/([CP])\d{6,8}$/);
  if (m) return m[1] === 'C' ? 'call' : 'put';
  return null;
}

function normalize(r) {
  return {
    symbol: strip(r.symbol || ''),
    strike: parseStrike(r),
    expiry: parseExpiry(r),
    contract_type: parseContractType(r),
    exchange: r.exchange || r.prefix || '',
    description: strip(r.description || ''),
  };
}

function applyFilters(contracts, { expiry_after, expiry_before, contract_type, strike_min, strike_max }) {
  const ctype = contract_type ? String(contract_type).toLowerCase() : null;
  const after = expiry_after || null;
  const before = expiry_before || null;
  const smin = Number.isFinite(Number(strike_min)) ? Number(strike_min) : null;
  const smax = Number.isFinite(Number(strike_max)) ? Number(strike_max) : null;

  return contracts.filter(c => {
    if (ctype && c.contract_type && c.contract_type !== ctype) return false;
    if (ctype && !c.contract_type) return false;
    if (smin !== null && (c.strike === null || c.strike < smin)) return false;
    if (smax !== null && (c.strike === null || c.strike > smax)) return false;
    // Expiry filters are lexicographic on YYYY-MM-DD (only applied when both sides parseable)
    if (after && c.expiry && c.expiry < after) return false;
    if (before && c.expiry && c.expiry > before) return false;
    return true;
  });
}

function dedupeSortCap(contracts, limit) {
  const seen = new Set();
  const out = [];
  for (const c of contracts) {
    if (!c.symbol || seen.has(c.symbol)) continue;
    seen.add(c.symbol);
    out.push(c);
  }
  out.sort((a, b) => {
    const as = a.strike === null ? Infinity : a.strike;
    const bs = b.strike === null ? Infinity : b.strike;
    if (as !== bs) return as - bs;
    return a.symbol.localeCompare(b.symbol);
  });
  return out.slice(0, limit);
}

/**
 * options_search core.
 * @returns { success, underlying, source, count, contracts: [{symbol,strike,expiry,contract_type,exchange,description}] }
 */
export async function searchContracts({
  underlying,
  expiry_after,
  expiry_before,
  contract_type,
  strike_min,
  strike_max,
  limit = 50,
  _deps,
} = {}) {
  if (!underlying || !String(underlying).trim()) throw new Error('underlying is required');

  const { fetch, evaluateAsync } = _resolve(_deps);
  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 50;
  lim = Math.max(1, Math.min(500, Math.floor(lim)));

  const filters = { expiry_after, expiry_before, contract_type, strike_min, strike_max };

  // ── Tier 1: public REST (no auth) ──────────────────────────────────────
  let raw = [];
  let source = 'rest_api';
  try {
    // URLSearchParams encodes `underlying` — it cannot break out of the query string.
    const params = new URLSearchParams({
      search_type: 'option',
      text: String(underlying),
      hl: '1',
      lang: 'en',
      domain: 'production',
    });
    const resp = await fetch(`https://symbol-search.tradingview.com/symbol_search/v3/?${params}`, {
      headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
    });
    if (resp && resp.ok) {
      const data = await resp.json();
      raw = data.symbols || (Array.isArray(data) ? data : []);
    }
  } catch {
    raw = [];
  }

  // ── Tier 2: renderer fallback (authenticated) ──────────────────────────
  if (!Array.isArray(raw) || raw.length === 0) {
    source = 'searchSymbols';
    const result = await evaluateAsync(`
      (async function() {
        try {
          var r = await window.TradingViewApi.searchSymbols({ text: ${safeString(underlying)}, type: 'option' });
          return r && r.symbols ? r.symbols : (Array.isArray(r) ? r : []);
        } catch (e) { return { __error: e && e.message ? e.message : String(e) }; }
      })()
    `);
    if (result && result.__error) throw new Error(result.__error);
    raw = Array.isArray(result) ? result : [];
  }

  const normalized = raw.map(normalize);
  const filtered = applyFilters(normalized, filters);
  const contracts = dedupeSortCap(filtered, lim);

  return { success: true, underlying: String(underlying), source, count: contracts.length, contracts };
}

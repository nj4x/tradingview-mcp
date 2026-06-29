/**
 * Core ETF-discovery logic.
 *
 * Two tools, both backed by TradingView's public scanner REST API (no auth):
 *   POST https://scanner.tradingview.com/america/scan
 *
 * The scanner returns rows shaped { s: "AMEX:VOO", d: [val0, val1, ...] } where
 * the `d` array is POSITIONAL — indexed by the requested `columns` array. We zip
 * `columns` against `d` to produce named records. A length mismatch between the two
 * is treated as a hard error (JS_EVAL) to prevent silent data corruption.
 *
 * Both calls run in the Node process via `fetch` (injected for testability).
 */
import { makeResolver } from './_resolve.js';
import { restFromNode, assertRestEnabled } from './_rest.js';
import { TvError } from './TvError.js';

const _resolve = makeResolver([], { fetch: globalThis.fetch });

const SCAN_URL = 'https://scanner.tradingview.com/america/scan';

const HEADERS = {
  'Content-Type': 'application/json',
  Origin: 'https://www.tradingview.com',
  'User-Agent': 'Mozilla/5.0',
};

/** Columns requested from the scanner, in positional order. */
const COLUMNS = [
  'name',
  'description',
  'close',
  'change',
  'aum',
  'expense_ratio',
  'asset_class.tr',
  'focus.tr',
  'nav_total_return.3Y',
  'fund_flows.1M',
  'fundamental_currency_code',
];

/** Columns used by etf_get (no currency code column). */
const GET_COLUMNS = [
  'name',
  'description',
  'close',
  'change',
  'aum',
  'expense_ratio',
  'asset_class.tr',
  'focus.tr',
  'nav_total_return.3Y',
  'fund_flows.1M',
];

/**
 * Zip a scanner row's positional `d` array against `columns` → named record.
 * Throws TvError('JS_EVAL') on a length mismatch (silent-corruption guard).
 */
function zipRow(row, columns) {
  const d = row && Array.isArray(row.d) ? row.d : null;
  if (!d || d.length !== columns.length) {
    throw new TvError(
      'JS_EVAL',
      `scanner row column count mismatch: expected ${columns.length}, got ${d ? d.length : 'none'}`,
    );
  }
  return Object.fromEntries(columns.map((c, i) => [c, d[i]]));
}

/** Map a zipped record + symbol into the public ETF return shape. */
function toEtf(symbol, record) {
  return {
    symbol,
    name: record['name'],
    description: record['description'],
    close: record['close'],
    change: record['change'],
    aum: record['aum'],
    expense_ratio: record['expense_ratio'],
    asset_class: record['asset_class.tr'],
    focus: record['focus.tr'],
    nav_return_3y: record['nav_total_return.3Y'],
    fund_flows_1m: record['fund_flows.1M'],
    currency: record['fundamental_currency_code'],
  };
}

/**
 * etf_search core. Scans US-listed funds, optionally filtered by a name/ticker phrase.
 * @returns { success, source, count, results: [etf...] }
 */
export async function searchEtfs({ query, limit = 50, _deps } = {}) {
  assertRestEnabled('etf_search');
  const { fetch } = _resolve(_deps);

  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 50;
  lim = Math.max(1, Math.min(200, Math.floor(lim)));

  const body = {
    filter: [{ left: 'type', operation: 'equal', right: 'fund' }],
    columns: COLUMNS,
    sort: { sortBy: 'aum', sortOrder: 'desc' },
    range: [0, lim],
  };

  const q = query == null ? '' : String(query).trim();
  if (q) {
    body.search = { type: 'phrase', query: q };
  }

  const data = await restFromNode(fetch, SCAN_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  const rows = data && Array.isArray(data.data) ? data.data : [];
  const results = rows.map((row) => toEtf(row.s, zipRow(row, COLUMNS)));

  return { success: true, source: 'rest_api', count: results.length, results };
}

/**
 * etf_get core. Fetches a single ETF by exact symbol (e.g. "AMEX:VOO").
 * Throws TvError if the symbol is not found.
 * @returns { success, source, etf }
 */
export async function getEtf({ symbol, _deps } = {}) {
  assertRestEnabled('etf_get');
  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');
  const { fetch } = _resolve(_deps);

  const ticker = String(symbol).trim();
  const body = {
    symbols: { tickers: [ticker] },
    columns: GET_COLUMNS,
  };

  const data = await restFromNode(fetch, SCAN_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  const rows = data && Array.isArray(data.data) ? data.data : [];
  if (rows.length === 0) {
    throw new TvError('JS_EVAL', `ETF not found: ${ticker}`, { retryable: false });
  }

  const row = rows[0];
  const etf = toEtf(row.s, zipRow(row, GET_COLUMNS));

  return { success: true, source: 'rest_api', etf };
}

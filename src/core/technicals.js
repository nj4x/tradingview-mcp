/**
 * Core technicals logic — TradingView Scanner "Recommend" ratings.
 *
 * technicals_get fetches the aggregate technical-analysis recommendation for a
 * symbol from TradingView's public scanner endpoint:
 *   POST https://scanner.tradingview.com/<screener>/scan
 *
 * No auth required — fetched from Node via restFromNode. The screener segment of
 * the URL MUST match the symbol's exchange (e.g. NASDAQ → america, BINANCE →
 * crypto). A wrong screener returns an empty data[] (no HTTP error), so screener
 * detection is reliable-by-prefix with an explicit `screener_guessed` flag when
 * the fallback ('america') is used.
 *
 * Recommend columns are on a ±1 scale:
 *   Recommend.All   → overall rating (oscillators + moving averages)
 *   Recommend.MA    → moving-averages rating
 *   Recommend.Other → oscillators rating
 */
import { makeResolver } from './_resolve.js';
import { restFromNode, assertRestEnabled } from './_rest.js';
import { TvError } from './TvError.js';

const _resolve = makeResolver([], { fetch: globalThis.fetch });

const DEFAULT_COLUMNS = ['Recommend.All', 'Recommend.MA', 'Recommend.Other'];

const INTERVAL_MAP = { '1h': '|60', '4h': '|240', '1D': '|1D', '1W': '|1W', '1M': '|1M' };

/**
 * Map a symbol's exchange prefix to a TradingView scanner screener.
 * Wrong screener = empty result (no error), so this must be reliable.
 * @param {string} symbol  e.g. "NASDAQ:AMZN", "BINANCE:BTCUSDT", "AMZN"
 * @returns {{ screener: string, guessed: boolean }}
 */
export function detectScreener(symbol) {
  const prefix = (symbol || '').split(':')[0].toUpperCase();
  const MAP = {
    NASDAQ: 'america', NYSE: 'america', AMEX: 'america', BATS: 'america', OTC: 'america',
    TSX: 'canada', TSXV: 'canada',
    LSE: 'uk', AIM: 'uk',
    XETR: 'germany', FSX: 'germany',
    BSE: 'india', NSE: 'india',
    BINANCE: 'crypto', COINBASE: 'crypto', KRAKEN: 'crypto', BITFINEX: 'crypto',
    'FX_IDC': 'forex', OANDA: 'forex', FXCM: 'forex',
    CME: 'futures', CBOT: 'futures', NYMEX: 'futures', COMEX: 'futures', EUREX: 'futures',
  };
  const screener = MAP[prefix];
  if (screener) return { screener, guessed: false };
  return { screener: 'america', guessed: true }; // fallback
}

/** Map a ±1 Recommend value to a human label. */
export function ratingLabel(v) {
  if (v === null || v === undefined) return 'N/A';
  if (v > 0.5) return 'Strong Buy';
  if (v > 0.1) return 'Buy';
  if (v >= -0.1) return 'Neutral';
  if (v >= -0.5) return 'Sell';
  return 'Strong Sell';
}

/** Build a {value,label} block for a named Recommend column. */
function ratingBlock(raw, col) {
  const value = raw[col];
  return { value: value ?? null, label: ratingLabel(value) };
}

/**
 * technicals_get core.
 * @param {{
 *   symbol: string,
 *   columns?: string[],
 *   interval?: '1h'|'4h'|'1D'|'1W'|'1M',
 *   _deps?: object
 * }} args
 */
export async function getTechnicals({ symbol, columns, interval, _deps } = {}) {
  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');
  assertRestEnabled('technicals_get');

  const { fetch } = _resolve(_deps);
  const resolvedSymbol = String(symbol).trim();

  const { screener, guessed } = detectScreener(resolvedSymbol);

  const baseCols = Array.isArray(columns) && columns.length ? columns : DEFAULT_COLUMNS;
  const suffix = interval && INTERVAL_MAP[interval] ? INTERVAL_MAP[interval] : null;
  const cols = baseCols.map(c => (suffix ? `${c}${suffix}` : c));

  const url = `https://scanner.tradingview.com/${screener}/scan`;
  const body = JSON.stringify({
    symbols: { tickers: [resolvedSymbol] },
    columns: cols,
  });

  const data = await restFromNode(fetch, url, {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.tradingview.com',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  const rows = data && Array.isArray(data.data) ? data.data : [];
  if (rows.length === 0) {
    throw new TvError('REST_HTTP', 'No scanner data for symbol — check screener or symbol format', { retryable: false });
  }

  const row = rows[0];
  const d = Array.isArray(row.d) ? row.d : [];
  if (d.length !== cols.length) {
    throw new TvError('JS_EVAL', 'Scanner column mismatch', { retryable: false });
  }

  // Positional zip: row.d[] indexed by cols
  const raw = Object.fromEntries(cols.map((c, i) => [c, d[i]]));

  // Pick the recommend blocks by their (interval-suffixed) column names.
  const allCol = suffix ? `Recommend.All${suffix}` : 'Recommend.All';
  const maCol = suffix ? `Recommend.MA${suffix}` : 'Recommend.MA';
  const otherCol = suffix ? `Recommend.Other${suffix}` : 'Recommend.Other';

  return {
    success: true,
    symbol: resolvedSymbol,
    screener,
    screener_guessed: guessed,
    interval: interval || null,
    recommendation: ratingBlock(raw, allCol),
    oscillators: ratingBlock(raw, otherCol),
    moving_averages: ratingBlock(raw, maCol),
    raw,
    source: 'rest_api',
  };
}

/**
 * Core financials + analyst-forecast logic.
 *
 * Both tools read TradingView's public symbol scanner endpoint (no auth):
 *   GET https://scanner.tradingview.com/symbol?symbol=<SYM>&fields=<csv>
 * which returns a FLAT JSON object keyed by the requested fields (no `data[]`
 * array, unlike the scanner POST screener). The fetch runs in the Node process
 * via `restFromNode`; symbol + fields are encoded with URLSearchParams so no raw
 * user value is ever templated into the URL.
 *
 * - financials_get → fundamentals (revenue, margins, valuation multiples, EPS)
 * - forecast_get   → analyst price targets + recommendation consensus, plus a
 *                    derived `recommendation_label` from `recommendation_mark`.
 */
import { makeResolver } from './_resolve.js';
import { restFromNode, assertRestEnabled } from './_rest.js';
import { TvError } from './TvError.js';

// These tools only need a Node `fetch`; no evaluate/evaluateAsync.
const _resolve = makeResolver([], { fetch: globalThis.fetch });

const SCANNER_URL = 'https://scanner.tradingview.com/symbol';

const REST_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Origin: 'https://www.tradingview.com',
};

const DEFAULT_FINANCIAL_FIELDS = [
  'total_revenue',
  'gross_profit',
  'net_income',
  'oper_income',
  'ebitda',
  'ebit',
  'total_assets',
  'total_liabilities',
  'total_equity',
  'price_earnings_ttm',
  'price_book',
  'price_cash_flow',
  'earnings_per_share_basic_ttm',
];

const DEFAULT_FORECAST_FIELDS = [
  'price_target_average',
  'price_target_high',
  'price_target_low',
  'price_target_median',
  'price_target_estimates_num',
  'recommendation_mark',
  'recommendation_buy',
  'recommendation_hold',
  'recommendation_sell',
  'recommendation_total',
  'earnings_per_share_forecast_next_fq',
  'revenue_forecast_next_fq',
  'earnings_release_next_date',
  'earnings_release_date',
];

/** Normalize a fields input (string csv | string[] | undefined) into a clean array. */
function normalizeFields(fields, defaults) {
  let arr;
  if (Array.isArray(fields)) {
    arr = fields;
  } else if (typeof fields === 'string' && fields.trim()) {
    arr = fields.split(',');
  } else {
    arr = defaults;
  }
  const cleaned = arr.map((f) => String(f).trim()).filter(Boolean);
  return cleaned.length ? cleaned : defaults;
}

/** Build the scanner symbol URL with symbol + fields encoded via URLSearchParams. */
function buildUrl(symbol, fields) {
  const qs = new URLSearchParams({ symbol, fields: fields.join(',') });
  return `${SCANNER_URL}?${qs.toString()}`;
}

/**
 * Map a recommendation_mark (1=Strong Buy .. 5=Strong Sell) to a human label.
 * Returns null when the mark is missing / non-finite.
 */
export function recommendationLabel(mark) {
  if (mark === null || mark === undefined || mark === '') return null;
  const m = Number(mark);
  if (!Number.isFinite(m)) return null;
  if (m <= 1.5) return 'Strong Buy';
  if (m <= 2.5) return 'Buy';
  if (m <= 3.5) return 'Hold';
  if (m <= 4.5) return 'Sell';
  return 'Strong Sell';
}

/**
 * Fetch fundamental financials for a symbol.
 * @param {{ symbol: string, fields?: string|string[], _deps?: object }} args
 * @returns {Promise<{ success: true, symbol: string, data: object, source: 'rest_api' }>}
 */
export async function fetchFinancials({ symbol, fields, _deps } = {}) {
  const { fetch } = _resolve(_deps);

  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');

  // REST-only: propagate REST_DISABLED before any try/catch.
  assertRestEnabled('financials_get');

  const fieldList = normalizeFields(fields, DEFAULT_FINANCIAL_FIELDS);
  const url = buildUrl(String(symbol).trim(), fieldList);
  const data = await restFromNode(fetch, url, { headers: REST_HEADERS });

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    throw new TvError('REST_HTTP', 'No financial data for symbol', { retryable: false });
  }

  return { success: true, symbol: String(symbol).trim(), data, source: 'rest_api' };
}

/**
 * Fetch analyst forecast / consensus for a symbol, with a derived
 * `recommendation_label` injected into the returned data object.
 * @param {{ symbol: string, fields?: string|string[], _deps?: object }} args
 * @returns {Promise<{ success: true, symbol: string, data: object, recommendation_label: string|null, source: 'rest_api' }>}
 */
export async function fetchForecast({ symbol, fields, _deps } = {}) {
  const { fetch } = _resolve(_deps);

  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');

  // REST-only: propagate REST_DISABLED before any try/catch.
  assertRestEnabled('forecast_get');

  const fieldList = normalizeFields(fields, DEFAULT_FORECAST_FIELDS);
  const url = buildUrl(String(symbol).trim(), fieldList);
  const data = await restFromNode(fetch, url, { headers: REST_HEADERS });

  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
    throw new TvError('REST_HTTP', 'No forecast data for symbol', { retryable: false });
  }

  const label = recommendationLabel(data.recommendation_mark);
  const enriched = { ...data, recommendation_label: label };

  return {
    success: true,
    symbol: String(symbol).trim(),
    data: enriched,
    recommendation_label: label,
    source: 'rest_api',
  };
}

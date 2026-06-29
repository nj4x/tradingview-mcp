/**
 * Core bond-search logic.
 *
 * bond_search queries TradingView's public bond scanner:
 *   POST https://scanner.tradingview.com/bond/scan
 *
 * The scanner is a confirmed-public, unauthenticated endpoint, so it is fetched
 * FROM Node via `restFromNode`. The response packs each row's values positionally
 * in `d[]` (indexed by the `columns` array we send) — those MUST be zipped back
 * against COLUMNS or the named fields will be wrong.
 *
 * Notable field shapes:
 *   - maturity_date          → YYYYMMDD integer (e.g. 20290430), parsed to ISO date
 *   - bond_yield_to_maturity → decimal (0.045 = 4.5%), returned as-is
 */
import { makeResolver } from './_resolve.js';
import { restFromNode, assertRestEnabled } from './_rest.js';
import { TvError } from './TvError.js';

const _resolve = makeResolver([], { fetch: globalThis.fetch });

/** Column order sent to the scanner — d[] is zipped against this. */
const COLUMNS = ['name', 'description', 'coupon', 'bond_yield_to_maturity', 'maturity_date', 'close', 'change'];

const SCAN_URL = 'https://scanner.tradingview.com/bond/scan';

/** YYYYMMDD integer (e.g. 20290430) → "2029-04-30", or null when unparseable. */
function parseYYYYMMDD(n) {
  if (!n) return null;
  const s = String(Math.floor(n));
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return null;
}

/** "2029-01-01" → 20290101 (integer) for scanner date filters. */
function dateToYYYYMMDDInt(date) {
  return parseInt(String(date).replace(/-/g, ''), 10);
}

/**
 * bond_search core.
 * @returns { success, count, total_count, results, source }
 */
export async function searchBonds({
  query,
  maturity_after,
  maturity_before,
  min_yield,
  max_yield,
  limit = 50,
  _deps,
} = {}) {
  assertRestEnabled('bond_search');

  const { fetch } = _resolve(_deps);

  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 50;
  lim = Math.max(1, Math.min(200, Math.floor(lim)));

  const body = {
    columns: [...COLUMNS],
    sort: { sortBy: 'bond_yield_to_maturity', sortOrder: 'desc' },
    range: [0, lim],
  };

  const filters = [];
  if (maturity_after) {
    filters.push({ left: 'maturity_date', operation: 'greater', right: dateToYYYYMMDDInt(maturity_after) });
  }
  if (maturity_before) {
    filters.push({ left: 'maturity_date', operation: 'less', right: dateToYYYYMMDDInt(maturity_before) });
  }
  if (min_yield !== undefined && min_yield !== null && min_yield !== '') {
    filters.push({ left: 'bond_yield_to_maturity', operation: 'greater_or_equal', right: Number(min_yield) });
  }
  if (max_yield !== undefined && max_yield !== null && max_yield !== '') {
    filters.push({ left: 'bond_yield_to_maturity', operation: 'less_or_equal', right: Number(max_yield) });
  }
  if (filters.length) body.filter = filters;

  if (query && String(query).trim()) {
    body.search = { type: 'phrase', query: String(query).trim() };
  }

  const data = await restFromNode(fetch, SCAN_URL, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://www.tradingview.com',
      'User-Agent': 'Mozilla/5.0',
    },
  });

  const rows = Array.isArray(data?.data) ? data.data : [];
  const results = rows.map((row) => {
    const d = Array.isArray(row?.d) ? row.d : [];
    if (d.length !== COLUMNS.length) {
      throw new TvError('JS_EVAL', 'Scanner column mismatch', { retryable: false });
    }
    const record = Object.fromEntries(COLUMNS.map((c, i) => [c, d[i]]));
    return {
      symbol: row.s,
      name: record['name'],
      description: record['description'],
      coupon: record['coupon'],
      yield_to_maturity: record['bond_yield_to_maturity'],
      maturity_date: parseYYYYMMDD(record['maturity_date']),
      close: record['close'],
      change: record['change'],
    };
  });

  return {
    success: true,
    count: results.length,
    total_count: data?.totalCount,
    results,
    source: 'rest_api',
  };
}

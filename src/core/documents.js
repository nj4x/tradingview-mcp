/**
 * Core document-screener logic. Lists corporate/financial documents for a
 * symbol (quarterly reports, transcripts, slides, press releases) and fetches
 * individual file views.
 *
 * REST-first per the project doctrine:
 *  - listDocuments uses the PUBLIC doc-screener listing endpoint (restFromNode,
 *    no credentials).
 *  - getDocumentFile uses the AUTHENTICATED file endpoint (restFromRenderer,
 *    session cookie via credentials: 'include').
 *
 * All dynamic URL params are encoded by the caller (URLSearchParams /
 * encodeURIComponent) BEFORE reaching _rest.js — never template raw user values
 * into an evaluated expression.
 */
import { makeResolver } from './_resolve.js';
import { restFromNode, restFromRenderer, assertRestEnabled } from './_rest.js';
import { TvError } from './TvError.js';

// listDocuments → public endpoint fetched from Node (no evaluate deps).
const _resolveList = makeResolver([], { fetch: globalThis.fetch });
// getDocumentFile → authenticated endpoint fetched from the logged-in renderer.
const _resolveFile = makeResolver(['evaluateAsync']);

const NODE_HEADERS = {
  'User-Agent': 'Mozilla/5.0',
  Origin: 'https://www.tradingview.com',
};

/**
 * List documents for a symbol via the public doc-screener endpoint.
 *
 * @param {{ symbol: string, categories?: string[], lang?: string, limit?: number, _deps?: object }} args
 */
export async function listDocuments({ symbol, categories, lang = 'en', limit = 20, _deps } = {}) {
  const { fetch } = _resolveList(_deps);

  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');

  // REST-only: propagate REST_DISABLED before any try/catch.
  assertRestEnabled('documents_list');

  const n = Number(limit);
  const lim = Math.max(1, Math.min(100, Number.isFinite(n) ? n : 20));

  const params = new URLSearchParams({ client: 'web' });
  params.append('filter', `symbol:${symbol}`);
  params.append('filter', `lang:${lang}`);
  if (Array.isArray(categories) && categories.length) {
    params.append('filter', `id:${categories.join(',')}`);
  }
  const url = `https://news-mediator.tradingview.com/public/doc-screener/v1/documents?${params}`;

  const data = await restFromNode(fetch, url, { headers: NODE_HEADERS });

  const items = Array.isArray(data?.items) ? data.items : [];
  const mapped = items
    .map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category?.id,
      category_title: item.category?.title,
      fiscal_period: item.fiscal_period,
      fiscal_year: item.fiscal_year,
      event: item.event,
      reported: item.reported ? new Date(item.reported * 1000).toISOString() : null,
      provider: item.provider?.name,
      form: item.form?.title,
      view_ids: (item.views || []).map((v) => ({ id: v.id, type: v.type })),
    }))
    .slice(0, lim);

  return {
    success: true,
    symbol,
    total: data?.total,
    count: mapped.length,
    items: mapped,
    source: 'rest_api',
  };
}

/**
 * Fetch a single document file/view via the authenticated file endpoint.
 * Soft-fails (returns file_available: false) on 401/403 so the caller's
 * workflow is never crashed by a missing documents entitlement.
 *
 * @param {{ view_id: string, _deps?: object }} args
 */
export async function getDocumentFile({ view_id, _deps } = {}) {
  const { evaluateAsync } = _resolveFile(_deps);

  if (!view_id || !String(view_id).trim()) throw new Error('view_id is required');

  // REST-only: propagate REST_DISABLED before any try/catch.
  assertRestEnabled('documents_get_file');

  const url = `https://news-mediator.tradingview.com/doc-screener/v1/files/${encodeURIComponent(view_id)}`;

  try {
    const data = await restFromRenderer(evaluateAsync, url);
    return { success: true, file_available: true, view_id, data, source: 'rest_api' };
  } catch (err) {
    const status = err instanceof TvError ? err.meta?.status : undefined;
    if (status === 403) {
      return {
        success: true,
        file_available: false,
        error: 'File access requires TradingView documents entitlement',
      };
    }
    if (status === 401) {
      return {
        success: true,
        file_available: false,
        error: 'TradingView session expired — re-open TradingView',
      };
    }
    throw err;
  }
}

/**
 * Community discovery core (REST-first, public endpoints, no auth).
 *
 * Three tools read TradingView's public community feeds for a symbol:
 *   - getIdeas    → published trade ideas        (/api/v1/ideas/)
 *   - getMinds    → short social posts ("Minds")  (/api/v2/minds/)
 *   - getScripts  → community Pine scripts         (/api/v1/scripts/)
 *
 * All three are unauthenticated public endpoints fetched FROM Node via
 * restFromNode (no session cookie). The symbol is always encoded with
 * encodeURIComponent so it cannot break out of the query string.
 *
 * DI: every function takes { _deps } and resolves `fetch` via makeResolver,
 * so tests inject a mock fetch and never touch the network.
 */
import { makeResolver } from './_resolve.js';
import { restFromNode, assertRestEnabled } from './_rest.js';

const _resolve = makeResolver([], { fetch: globalThis.fetch });

const BASE = 'https://www.tradingview.com';

/** Browser-ish headers so the public endpoints don't 403 a bare Node client. */
const COMMUNITY_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  Origin: 'https://www.tradingview.com',
  Referer: 'https://www.tradingview.com/',
};

function requireSymbol(symbol) {
  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');
  return String(symbol).trim();
}

/**
 * Recursively flatten a ProseMirror text AST (Minds `text_ast`) into plain text.
 * Nodes are either leaves with `.text` or branches with `.children` / `.content`.
 */
export function walkAst(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(walkAst).join('');
  if (node.text) return node.text;
  if (Array.isArray(node.children)) return node.children.map(walkAst).join('');
  if (Array.isArray(node.content)) return node.content.map(walkAst).join('');
  return '';
}

/** Extract the opaque `c` cursor from a Minds `next` URL; null if absent/malformed. */
function extractCursor(next) {
  if (!next) return null;
  try {
    return new URL(next).searchParams.get('c');
  } catch {
    return null;
  }
}

/**
 * community_get_ideas — published trade ideas for a symbol.
 * @returns { success, symbol, page, total, page_size, page_count, has_more, count, results, source }
 */
export async function getIdeas({ symbol, page = 1, sort = 'recent', _deps } = {}) {
  assertRestEnabled('community_get_ideas');
  const sym = requireSymbol(symbol);
  const { fetch } = _resolve(_deps);

  let pageNum = Number(page);
  if (!Number.isFinite(pageNum) || pageNum < 1) pageNum = 1;
  pageNum = Math.floor(pageNum);

  const validSorts = new Set(['recent', 'popular', 'trending']);
  const sortVal = validSorts.has(sort) ? sort : 'recent';

  const params = new URLSearchParams({ page: String(pageNum), sort: sortVal });
  const url = `${BASE}/api/v1/ideas/?symbol=${encodeURIComponent(sym)}&${params}`;

  const data = await restFromNode(fetch, url, { headers: COMMUNITY_HEADERS });
  const results = Array.isArray(data?.results) ? data.results : [];

  return {
    success: true,
    symbol: sym,
    page: pageNum,
    total: data?.count ?? null,
    page_size: data?.page_size ?? null,
    page_count: data?.page_count ?? null,
    has_more: !!data?.next,
    count: results.length,
    results: results.map(r => ({
      id: r.id,
      title: r.name,
      description: r.description,
      created_at: r.created_at,
      chart_url: r.chart_url,
      is_hot: r.is_hot,
      comments: r.comments_count,
      views: r.views_count,
      likes: r.likes_count,
      author: r.user?.username,
    })),
    source: 'rest_api',
  };
}

/**
 * community_get_minds — short social posts ("Minds") for a symbol.
 * @returns { success, symbol, count, has_more, next_cursor, results, source }
 */
export async function getMinds({ symbol, limit = 20, cursor, _deps } = {}) {
  assertRestEnabled('community_get_minds');
  const sym = requireSymbol(symbol);
  const { fetch } = _resolve(_deps);

  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 20;
  lim = Math.max(1, Math.min(50, Math.floor(lim)));

  const params = new URLSearchParams({ limit: String(lim) });
  if (cursor) params.set('c', String(cursor));
  const url = `${BASE}/api/v2/minds/?symbol=${encodeURIComponent(sym)}&${params}`;

  const data = await restFromNode(fetch, url, { headers: COMMUNITY_HEADERS });
  const results = Array.isArray(data?.results) ? data.results : [];

  return {
    success: true,
    symbol: sym,
    count: results.length,
    has_more: !!data?.next,
    next_cursor: extractCursor(data?.next),
    results: results.map(r => ({
      id: r.uid,
      text: walkAst(r.text_ast),
      author: r.author?.username,
      created: r.created,
      comments: r.total_comments,
    })),
    source: 'rest_api',
  };
}

/**
 * community_get_scripts — community Pine scripts for a symbol (optional keyword).
 * @returns { success, symbol, page, total, has_more, count, results, source }
 */
export async function getScripts({ symbol, query, page = 1, _deps } = {}) {
  assertRestEnabled('community_get_scripts');
  const sym = requireSymbol(symbol);
  const { fetch } = _resolve(_deps);

  let pageNum = Number(page);
  if (!Number.isFinite(pageNum) || pageNum < 1) pageNum = 1;
  pageNum = Math.floor(pageNum);

  const params = new URLSearchParams({ page: String(pageNum) });
  if (query && String(query).trim()) params.set('q', String(query).trim());
  const url = `${BASE}/api/v1/scripts/?symbol=${encodeURIComponent(sym)}&${params}`;

  const data = await restFromNode(fetch, url, { headers: COMMUNITY_HEADERS });
  const results = Array.isArray(data?.results) ? data.results : [];

  return {
    success: true,
    symbol: sym,
    page: pageNum,
    total: data?.count ?? null,
    has_more: !!data?.next,
    count: results.length,
    results: results.map(r => ({
      id: r.id,
      title: r.name,
      description: r.description,
      created_at: r.created_at,
      views: r.views_count,
      likes: r.likes_count,
      author: r.user?.username,
    })),
    source: 'rest_api',
  };
}

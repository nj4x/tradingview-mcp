/**
 * Core news logic. Fetches TradingView news via the REST-first framework
 * (_rest.js): the renderer only executes the authenticated HTTP fetch
 * (credentials: 'include' carries the logged-in session cookie); all
 * post-processing (item mapping, story-body flattening) happens here in Node.
 */
import { makeResolver } from './_resolve.js';
import { restFromRenderer, assertRestEnabled } from './_rest.js';

const _resolve = makeResolver(['evaluate', 'evaluateAsync']);

export async function getHeadlines({ symbol, limit = 25, _deps } = {}) {
  const { evaluate, evaluateAsync } = _resolve(_deps);

  // REST-only: propagate REST_DISABLED before any try/catch.
  assertRestEnabled('news_get_headlines');

  const n = Number(limit);
  const lim = Math.max(1, Math.min(50, Number.isFinite(n) ? n : 25));

  let resolvedSym;
  if (symbol) {
    resolvedSym = symbol;
  } else {
    resolvedSym = await evaluate('window.TradingViewApi.activeChart().symbolExt().pro_name');
  }
  const encSymbol = encodeURIComponent(resolvedSym);

  const url = `https://news-headlines.tradingview.com/v2/view/headlines/symbol?client=overview&lang=en&symbol=${encSymbol}`;
  const data = await restFromRenderer(evaluateAsync, url);

  const results = (data.items || []).slice(0, lim).map((item) => ({
    id: item.id,
    title: item.title,
    provider: item.provider?.name || item.provider,
    published: item.published,
    urgency: item.urgency,
    source: item.source,
    relatedSymbols: item.relatedSymbols || [],
  }));

  return { success: true, symbol: resolvedSym, count: results.length, results, source: 'rest_api' };
}

export async function getStory({ id, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);

  if (!id || !String(id).trim()) throw new Error('id is required');

  // REST-only: propagate REST_DISABLED before any try/catch.
  assertRestEnabled('news_get_story');

  const url = `https://news-headlines.tradingview.com/v2/story?client=overview&lang=en&id=${encodeURIComponent(id)}`;
  const data = await restFromRenderer(evaluateAsync, url);

  function flat(node) {
    if (!node) return '';
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(flat).join('');
    if (node.content) return flat(node.content);
    return '';
  }

  return {
    success: true,
    title: data.title,
    provider: data.provider?.name || data.provider,
    source: data.source,
    published: data.published,
    link: data.link || data.storyPath,
    shortDescription: data.shortDescription || '',
    body: flat(data.content || data.body || data.story_body || ''),
  };
}

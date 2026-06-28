/**
 * Core news logic. Fetches TradingView news from inside the renderer so the
 * logged-in session cookie is carried (credentials: 'include').
 */
import { evaluateAsync as _evaluateAsync, safeString } from '../connection.js';
import { makeResolver } from './_resolve.js';

const _resolve = makeResolver(['evaluateAsync']);

export async function getHeadlines({ symbol, limit = 25, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 25;
  lim = Math.max(1, Math.min(50, Math.floor(lim)));

  const symExpr = symbol
    ? safeString(symbol)
    : `window.TradingViewApi.activeChart().symbolExt().pro_name`;

  const expr = `
    (async function() {
      try {
        var sym = ${symExpr};
        var url = 'https://news-headlines.tradingview.com/v2/view/headlines/symbol?client=overview&lang=en&symbol=' + encodeURIComponent(sym);
        var resp = await fetch(url, { credentials: 'include' });
        var data = await resp.json();
        var items = (data.items || []).slice(0, ${lim}).map(function(it) {
          return {
            id: it.id,
            title: it.title,
            provider: it.provider,
            published: it.published,
            urgency: it.urgency,
            source: it.source,
            relatedSymbols: (it.relatedSymbols || []).map(function(r) { return r.symbol; }),
          };
        });
        return { symbol: sym, results: items };
      } catch (e) {
        return { __error: e && e.message ? e.message : String(e) };
      }
    })()
  `;

  const result = await evaluateAsync(expr);
  if (result && result.__error) throw new Error(result.__error);
  const results = (result && result.results) || [];
  return { success: true, symbol: result && result.symbol, count: results.length, results };
}

export async function getStory({ id, _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);
  if (!id || !String(id).trim()) throw new Error('Story id required');

  const expr = `
    (async function() {
      try {
        var url = 'https://news-headlines.tradingview.com/v2/story?id=' + encodeURIComponent(${safeString(id)}) + '&lang=en';
        var resp = await fetch(url, { credentials: 'include' });
        var data = await resp.json();
        function flat(node) {
          if (typeof node === 'string') return node;
          if (!node) return '';
          if (Array.isArray(node)) return node.map(flat).join('');
          if (node.children) return node.children.map(flat).join('');
          return '';
        }
        var body = '';
        var ast = data.astDescription;
        if (ast && ast.children) {
          body = ast.children.map(flat).join('\\n\\n');
        }
        return {
          title: data.title,
          provider: data.provider,
          source: data.source,
          published: data.published,
          link: data.link,
          shortDescription: data.shortDescription,
          body: body,
        };
      } catch (e) {
        return { __error: e && e.message ? e.message : String(e) };
      }
    })()
  `;

  const result = await evaluateAsync(expr);
  if (result && result.__error) throw new Error(result.__error);
  return { success: true, ...result };
}

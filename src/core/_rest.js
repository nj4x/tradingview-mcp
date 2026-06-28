// src/core/_rest.js
//
// REST-first tooling framework. The TradingView MCP doctrine is to prefer
// direct TradingView REST endpoints over GUI/DOM CDP manipulation wherever a
// stable endpoint exists. Authenticated endpoints are fetched FROM the
// logged-in renderer (credentials: 'include') so the session cookie is carried;
// confirmed-public endpoints may be fetched from Node.
//
// CDP injection safety is mandatory: buildFetchExpr() is the ONLY place that
// produces an injectable JS string, and every interpolated value passes through
// safeString(). Callers MUST pre-build any dynamic query string (URLSearchParams /
// encodeURIComponent) into the plain `url` string they pass here — never template
// a raw user value into the expression themselves.

import { safeString } from './_safe.js';
import { TvError } from './TvError.js';

/** OPS rollback lever: TV_MCP_REST=0 → force every migrated tool onto its CDP path. */
export function isRestDisabled() {
  return process.env.TV_MCP_REST === '0';
}

/**
 * Throw `TvError('REST_DISABLED')` when TV_MCP_REST=0 and the tool has no CDP fallback.
 * Call at the top of any REST-only function, BEFORE any try/catch, so the error always
 * propagates to the caller (never swallowed by a soft-failure catch block).
 *
 * @param {string} tool  stable tool name for the error message (e.g. 'news_get_headlines')
 */
export function assertRestEnabled(tool) {
  if (isRestDisabled()) {
    throw new TvError('REST_DISABLED',
      `TV_MCP_REST=0 is set but "${tool}" has no CDP fallback and cannot run without REST`);
  }
}

/**
 * Build a self-contained renderer expression that fetches `url` and returns a
 * normalized envelope: { __ok: true, status, data } on success (2xx),
 * { __ok: false, status, data } on a non-2xx HTTP response, or
 * { __error: message } if fetch/parse threw.
 *
 * @param {string} url  fully-formed URL (dynamic params already encoded by caller)
 * @param {{ method?: string, body?: string, headers?: object, credentials?: string, parse?: 'json'|'text' }} [opts]
 * @returns {string} a JS expression (an awaited async IIFE)
 */
export function buildFetchExpr(url, opts = {}) {
  const { method = 'GET', body, headers, credentials = 'include', parse = 'json' } = opts;

  const initParts = [`method: ${safeString(method)}`, `credentials: ${safeString(credentials)}`];
  if (headers && typeof headers === 'object') {
    const pairs = Object.entries(headers)
      .map(([k, v]) => `${safeString(String(k))}: ${safeString(String(v))}`)
      .join(', ');
    initParts.push(`headers: { ${pairs} }`);
  }
  if (body !== undefined && body !== null) {
    initParts.push(`body: ${safeString(String(body))}`);
  }
  const init = `{ ${initParts.join(', ')} }`;
  const readBody = parse === 'text' ? 'await resp.text()' : 'await resp.json()';

  return `
    (async function() {
      try {
        var resp = await fetch(${safeString(url)}, ${init});
        var data = ${readBody};
        return { __ok: resp.ok, status: resp.status, data: data };
      } catch (e) {
        return { __error: e && e.message ? e.message : String(e) };
      }
    })()
  `;
}

function classifyHttp(status) {
  // retryable on transient server / rate-limit conditions
  const retryable = status === 429 || (status >= 500 && status <= 599);
  return new TvError('REST_HTTP', `REST request failed with HTTP ${status}`, {
    retryable,
    meta: { status },
  });
}

/**
 * Execute an authenticated fetch from the logged-in renderer and return parsed JSON.
 * Throws TvError('REST_HTTP') on a non-2xx response, or a plain Error on fetch/parse failure.
 *
 * @param {(expr: string) => Promise<any>} evaluateAsync  renderer async evaluator
 * @param {string} url  fully-formed URL
 * @param {object} [opts]  see buildFetchExpr
 * @returns {Promise<any>} the parsed response body
 */
export async function restFromRenderer(evaluateAsync, url, opts = {}) {
  const envelope = await evaluateAsync(buildFetchExpr(url, opts));
  if (!envelope) throw new Error('REST request returned no response from renderer');
  if (envelope.__error) throw new Error(envelope.__error);
  if (!envelope.__ok) throw classifyHttp(envelope.status);
  return envelope.data;
}

/**
 * Execute a fetch from Node — for confirmed-public, unauthenticated endpoints only
 * (e.g. symbol-search.tradingview.com). No credentials are sent.
 *
 * @param {typeof fetch} fetchImpl  injected fetch (globalThis.fetch by default)
 * @param {string} url
 * @param {{ method?: string, body?: string, headers?: object, parse?: 'json'|'text' }} [opts]
 * @returns {Promise<any>}
 */
export async function restFromNode(fetchImpl, url, opts = {}) {
  const { method = 'GET', body, headers, parse = 'json' } = opts;
  const init = { method };
  if (headers) init.headers = headers;
  if (body !== undefined && body !== null) init.body = body;
  const resp = await fetchImpl(url, init);
  if (!resp.ok) throw classifyHttp(resp.status);
  return parse === 'text' ? resp.text() : resp.json();
}

/**
 * Wrap a successful REST payload in the canonical { success: true, ... } shape,
 * tagging provenance via `source`. Migrated tools MUST preserve their existing
 * return keys; only `source` is added/overridden.
 */
export function normalizeOk(partial = {}, source = 'rest_api') {
  return { success: true, ...partial, source };
}

/** Canonical error shape mirroring existing tool error returns. */
export function normalizeErr(err, source = 'rest_api') {
  const message = err && err.message ? err.message : String(err);
  return { success: false, error: message, source };
}

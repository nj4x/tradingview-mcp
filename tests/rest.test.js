/**
 * Offline unit tests for src/core/_rest.js — the REST framework.
 * No live TradingView required.
 * Run: node --test tests/rest.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildFetchExpr, isRestDisabled, assertRestEnabled, normalizeOk, normalizeErr, restFromRenderer, restFromNode } from '../src/core/_rest.js';
import { TvError } from '../src/core/TvError.js';

// ── isRestDisabled ────────────────────────────────────────────────────────────

describe('isRestDisabled()', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('returns false when TV_MCP_REST is unset', () => {
    delete process.env.TV_MCP_REST;
    assert.equal(isRestDisabled(), false);
  });

  it('returns true when TV_MCP_REST=0', () => {
    process.env.TV_MCP_REST = '0';
    assert.equal(isRestDisabled(), true);
  });

  it('returns false when TV_MCP_REST=1', () => {
    process.env.TV_MCP_REST = '1';
    assert.equal(isRestDisabled(), false);
  });
});

// ── assertRestEnabled ─────────────────────────────────────────────────────────

describe('assertRestEnabled()', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('throws TvError(REST_DISABLED) when TV_MCP_REST=0', () => {
    process.env.TV_MCP_REST = '0';
    assert.throws(
      () => assertRestEnabled('test_tool'),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        assert.ok(err.message.includes('test_tool'));
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  it('does not throw when TV_MCP_REST is unset', () => {
    delete process.env.TV_MCP_REST;
    assert.doesNotThrow(() => assertRestEnabled('test_tool'));
  });

  it('does not throw when TV_MCP_REST=1', () => {
    process.env.TV_MCP_REST = '1';
    assert.doesNotThrow(() => assertRestEnabled('test_tool'));
  });
});

// ── buildFetchExpr ────────────────────────────────────────────────────────────

describe('buildFetchExpr()', () => {
  it('embeds the URL via safeString (JSON-escaped)', () => {
    const expr = buildFetchExpr('https://example.com/api?q=1&r=2');
    assert.ok(expr.includes('"https://example.com/api?q=1&r=2"'), 'URL should be JSON-quoted');
  });

  it('escapes quote-injection in the URL — cannot break out of the JS string literal', () => {
    // A URL containing '" + alert(1) + "' would break out of a naive template literal.
    // safeString() (= JSON.stringify) escapes the inner " to \", preventing the break-out.
    const maliciousUrl = 'https://x.com/api?q=" + alert(1) + "';
    const expr = buildFetchExpr(maliciousUrl);
    // The raw " characters must be escaped in the expression
    assert.ok(!expr.includes('" + alert(1) + "'), 'raw break-out sequence must not appear unescaped');
    // The escaped form should be present
    assert.ok(expr.includes('\\" + alert(1) + \\"') || expr.includes('\\u0022'), 'double quotes must be escaped');
  });

  it('uses credentials:include by default', () => {
    const expr = buildFetchExpr('https://x.com/');
    assert.ok(expr.includes('"include"'), 'credentials should be include');
  });

  it('allows overriding credentials to omit', () => {
    const expr = buildFetchExpr('https://x.com/', { credentials: 'omit' });
    assert.ok(expr.includes('"omit"'));
  });

  it('includes POST method and body when provided', () => {
    const expr = buildFetchExpr('https://x.com/', { method: 'POST', body: '{"k":"v"}' });
    assert.ok(expr.includes('"POST"'));
    assert.ok(expr.includes('"{\\"k\\":\\"v\\"}"') || expr.includes('{"k":"v"}'));
  });

  it('emits resp.text() when parse=text', () => {
    const expr = buildFetchExpr('https://x.com/', { parse: 'text' });
    assert.ok(expr.includes('resp.text()'));
  });

  it('emits resp.json() by default', () => {
    const expr = buildFetchExpr('https://x.com/');
    assert.ok(expr.includes('resp.json()'));
  });

  it('includes custom headers via safeString', () => {
    const expr = buildFetchExpr('https://x.com/', { headers: { 'X-Foo': 'bar"baz' } });
    assert.ok(expr.includes('"X-Foo"'));
    assert.ok(expr.includes('"bar\\"baz"') || expr.includes('bar\\\"baz'));
  });

  it('returns an awaited async IIFE', () => {
    const expr = buildFetchExpr('https://x.com/');
    assert.ok(expr.includes('async function'), 'should be an async IIFE');
    assert.ok(expr.includes('__ok'), 'should return envelope with __ok');
    assert.ok(expr.includes('__error'), 'should catch and return __error');
  });
});

// ── normalizeOk / normalizeErr ────────────────────────────────────────────────

describe('normalizeOk()', () => {
  it('returns success:true and spreads partial', () => {
    const r = normalizeOk({ count: 5, symbols: [] });
    assert.equal(r.success, true);
    assert.equal(r.count, 5);
    assert.equal(r.source, 'rest_api');
  });

  it('allows custom source', () => {
    const r = normalizeOk({}, 'cdp_fallback');
    assert.equal(r.source, 'cdp_fallback');
  });
});

describe('normalizeErr()', () => {
  it('returns success:false with message', () => {
    const r = normalizeErr(new Error('boom'));
    assert.equal(r.success, false);
    assert.equal(r.error, 'boom');
    assert.equal(r.source, 'rest_api');
  });

  it('handles string errors', () => {
    const r = normalizeErr('oops');
    assert.equal(r.error, 'oops');
  });
});

// ── restFromRenderer ──────────────────────────────────────────────────────────

describe('restFromRenderer()', () => {
  it('returns envelope.data on 2xx success', async () => {
    const evaluateAsync = async () => ({ __ok: true, status: 200, data: [{ active: true, symbols: ['AAPL'] }] });
    const result = await restFromRenderer(evaluateAsync, 'https://x.com/');
    assert.deepEqual(result, [{ active: true, symbols: ['AAPL'] }]);
  });

  it('throws TvError(REST_HTTP) on non-2xx response', async () => {
    const evaluateAsync = async () => ({ __ok: false, status: 403, data: null });
    await assert.rejects(
      () => restFromRenderer(evaluateAsync, 'https://x.com/'),
      (err) => {
        assert.ok(err instanceof TvError, 'should be TvError');
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.meta.status, 403);
        assert.equal(err.retryable, false, '403 should not be retryable');
        return true;
      },
    );
  });

  it('marks 429 as retryable', async () => {
    const evaluateAsync = async () => ({ __ok: false, status: 429, data: null });
    await assert.rejects(
      () => restFromRenderer(evaluateAsync, 'https://x.com/'),
      (err) => { assert.equal(err.retryable, true); return true; },
    );
  });

  it('marks 500 as retryable', async () => {
    const evaluateAsync = async () => ({ __ok: false, status: 500, data: null });
    await assert.rejects(
      () => restFromRenderer(evaluateAsync, 'https://x.com/'),
      (err) => { assert.equal(err.retryable, true); return true; },
    );
  });

  it('throws plain Error on __error from renderer', async () => {
    const evaluateAsync = async () => ({ __error: 'network error' });
    await assert.rejects(
      () => restFromRenderer(evaluateAsync, 'https://x.com/'),
      /network error/,
    );
  });

  it('throws when evaluateAsync returns no response', async () => {
    const evaluateAsync = async () => null;
    await assert.rejects(
      () => restFromRenderer(evaluateAsync, 'https://x.com/'),
      /no response from renderer/,
    );
  });
});

// ── restFromNode ──────────────────────────────────────────────────────────────

describe('restFromNode()', () => {
  // Import here — we need the actual function
  let restFromNodeFn;
  before(async () => {
    ({ restFromNode: restFromNodeFn } = await import('../src/core/_rest.js'));
  });

  it('returns parsed JSON on 200', async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ foo: 1 }), text: async () => '' });
    const result = await restFromNodeFn(fetchImpl, 'https://x.com/');
    assert.deepEqual(result, { foo: 1 });
  });

  it('throws TvError(REST_HTTP) on !resp.ok', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, json: async () => null, text: async () => '' });
    await assert.rejects(
      () => restFromNodeFn(fetchImpl, 'https://x.com/'),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.meta.status, 404);
        return true;
      },
    );
  });
});

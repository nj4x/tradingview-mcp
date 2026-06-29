/**
 * Offline DI-mock tests for the bonds core module (REST-only via restFromNode).
 * No live chart required. A mock `fetch` is injected through `_deps`.
 *
 * Run: node --test tests/bonds.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { searchBonds } from '../src/core/bonds.js';
import { TvError } from '../src/core/TvError.js';

const COLUMNS = ['name', 'description', 'coupon', 'bond_yield_to_maturity', 'maturity_date', 'close', 'change'];

// Ensure REST is enabled for the default test groups (clear any inherited =0).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/**
 * Build a mock fetch that captures the request and returns the given payload.
 * `capture` accumulates { url, init, body } for assertions on the outgoing request.
 */
function makeFetch(payload, capture, { ok = true, status = 200 } = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.init = init;
    capture.body = init && init.body ? JSON.parse(init.body) : null;
    return { ok, status, json: async () => payload };
  };
}

function oneRow(overrides = {}) {
  const d = overrides.d || ['US Treasury 4%', '4% Treasury Bond', 0.04, 0.045, 20290430, 98.5, 0.2];
  return { totalCount: 256196, data: [{ s: overrides.s || 'BOND1', d }] };
}

// ---------------------------------------------------------------------------
describe('searchBonds()', () => {
  it('hits scanner.tradingview.com/bond/scan via POST', async () => {
    const cap = {};
    const out = await searchBonds({ _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.equal(cap.url, 'https://scanner.tradingview.com/bond/scan');
    assert.equal(cap.init.method, 'POST');
    assert.equal(out.success, true);
  });

  it('default request body has correct columns and sort', async () => {
    const cap = {};
    await searchBonds({ _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.deepEqual(cap.body.columns, COLUMNS);
    assert.deepEqual(cap.body.sort, { sortBy: 'bond_yield_to_maturity', sortOrder: 'desc' });
    assert.deepEqual(cap.body.range, [0, 50], 'default range uses default limit 50');
  });

  it('positional zip: returned records have named fields', async () => {
    const cap = {};
    const out = await searchBonds({ _deps: { fetch: makeFetch(oneRow(), cap) } });
    const r = out.results[0];
    assert.equal(r.symbol, 'BOND1');
    assert.equal(r.name, 'US Treasury 4%');
    assert.equal(r.description, '4% Treasury Bond');
    assert.equal(r.coupon, 0.04);
    assert.equal(r.close, 98.5);
    assert.equal(r.change, 0.2);
  });

  it('maturity_date parsed from YYYYMMDD integer to YYYY-MM-DD', async () => {
    const cap = {};
    const out = await searchBonds({ _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.equal(out.results[0].maturity_date, '2029-04-30');
  });

  it('yield_to_maturity returned as-is (decimal, not multiplied)', async () => {
    const cap = {};
    const out = await searchBonds({ _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.equal(out.results[0].yield_to_maturity, 0.045);
  });

  it('maturity_after → greater filter with integer right value', async () => {
    const cap = {};
    await searchBonds({ maturity_after: '2029-01-01', _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.ok(Array.isArray(cap.body.filter));
    assert.deepEqual(
      cap.body.filter.find((f) => f.left === 'maturity_date' && f.operation === 'greater'),
      { left: 'maturity_date', operation: 'greater', right: 20290101 },
    );
    assert.equal(typeof cap.body.filter[0].right, 'number');
  });

  it('maturity_before → less filter with integer right value', async () => {
    const cap = {};
    await searchBonds({ maturity_before: '2031-12-31', _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.deepEqual(
      cap.body.filter.find((f) => f.left === 'maturity_date' && f.operation === 'less'),
      { left: 'maturity_date', operation: 'less', right: 20311231 },
    );
  });

  it('min_yield → greater_or_equal filter', async () => {
    const cap = {};
    await searchBonds({ min_yield: 0.04, _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.deepEqual(
      cap.body.filter.find((f) => f.operation === 'greater_or_equal'),
      { left: 'bond_yield_to_maturity', operation: 'greater_or_equal', right: 0.04 },
    );
  });

  it('max_yield → less_or_equal filter', async () => {
    const cap = {};
    await searchBonds({ max_yield: 0.08, _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.deepEqual(
      cap.body.filter.find((f) => f.operation === 'less_or_equal'),
      { left: 'bond_yield_to_maturity', operation: 'less_or_equal', right: 0.08 },
    );
  });

  it('query adds search phrase to body', async () => {
    const cap = {};
    await searchBonds({ query: 'Treasury', _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.deepEqual(cap.body.search, { type: 'phrase', query: 'Treasury' });
  });

  it('column count mismatch → TvError(JS_EVAL)', async () => {
    const cap = {};
    const bad = { totalCount: 1, data: [{ s: 'X', d: ['only', 'three', 'cols'] }] };
    await assert.rejects(
      () => searchBonds({ _deps: { fetch: makeFetch(bad, cap) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'JS_EVAL');
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  it('HTTP 429 → TvError(REST_HTTP, retryable: true)', async () => {
    const cap = {};
    await assert.rejects(
      () => searchBonds({ _deps: { fetch: makeFetch(null, cap, { ok: false, status: 429 }) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, true);
        assert.equal(err.meta?.status, 429);
        return true;
      },
    );
  });

  it('HTTP 503 → TvError(REST_HTTP, retryable: true)', async () => {
    const cap = {};
    await assert.rejects(
      () => searchBonds({ _deps: { fetch: makeFetch(null, cap, { ok: false, status: 503 }) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, true);
        assert.equal(err.meta?.status, 503);
        return true;
      },
    );
  });

  it('limit clamps: 999→200, 0→1, -5→1', async () => {
    const cap1 = {};
    await searchBonds({ limit: 999, _deps: { fetch: makeFetch(oneRow(), cap1) } });
    assert.deepEqual(cap1.body.range, [0, 200]);

    const cap2 = {};
    await searchBonds({ limit: 0, _deps: { fetch: makeFetch(oneRow(), cap2) } });
    assert.deepEqual(cap2.body.range, [0, 1]);

    const cap3 = {};
    await searchBonds({ limit: -5, _deps: { fetch: makeFetch(oneRow(), cap3) } });
    assert.deepEqual(cap3.body.range, [0, 1]);
  });

  it('source: rest_api and total_count present in return', async () => {
    const cap = {};
    const out = await searchBonds({ _deps: { fetch: makeFetch(oneRow(), cap) } });
    assert.equal(out.source, 'rest_api');
    assert.equal(out.total_count, 256196);
    assert.equal(out.count, 1);
  });
});

// ---------------------------------------------------------------------------
describe('searchBonds() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    const cap = {};
    await assert.rejects(
      () => searchBonds({ _deps: { fetch: makeFetch(oneRow(), cap) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

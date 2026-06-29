/**
 * Offline DI-mock tests for the documents core module (REST-migrated).
 * No live chart required.
 *
 *  - listDocuments uses restFromNode → inject a mock `fetch`.
 *  - getDocumentFile uses restFromRenderer → inject a mock `evaluateAsync`
 *    returning a { __ok, status, data } envelope.
 *
 * Run: node --test tests/documents.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { listDocuments, getDocumentFile } from '../src/core/documents.js';
import { TvError } from '../src/core/TvError.js';

// Ensure REST is enabled for the default test groups (clear any inherited =0).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/** Build a Node fetch mock. captures the requested url for assertions. */
function makeFetch(responseData, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok, status, json: async () => responseData };
  };
  fn.calls = calls;
  return fn;
}

/** Build an evaluateAsync that returns a REST envelope. */
function makeEvalAsync(responseData, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (expr) => { calls.push(expr); return { __ok: ok, status, data: responseData }; };
  fn.calls = calls;
  return fn;
}

const SAMPLE_ITEM = {
  id: 'urn:report:quartr.com:123',
  title: 'Q1 2026',
  category: { id: 'quarterly_report', title: 'Quarterly report' },
  fiscal_period: 'Q1',
  fiscal_year: 2026,
  event: 'earning',
  reported: 1777498200,
  provider: { id: 'quartr', name: 'Quartr' },
  form: { id: 'form_10q', title: '10-Q' },
  views: [
    { id: 'urn:report:quartr.com:123-abc', type: 'pdf' },
    { id: 'urn:summary_document_report:quartr.com:456', type: 'summary' },
  ],
};

// ---------------------------------------------------------------------------
// listDocuments
// ---------------------------------------------------------------------------
describe('listDocuments()', () => {
  it('symbol is required', async () => {
    await assert.rejects(
      () => listDocuments({ _deps: { fetch: makeFetch({ total: 0, items: [] }) } }),
      /symbol is required/,
    );
  });

  it('builds the correct base path and includes sorted default lang + symbol filters', async () => {
    const fetch = makeFetch({ total: 1, items: [SAMPLE_ITEM] });
    await listDocuments({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });

    const url = fetch.calls[0].url;
    const parsed = new URL(url);
    assert.equal(
      parsed.origin + parsed.pathname,
      'https://news-mediator.tradingview.com/public/doc-screener/v1/documents',
    );
    assert.equal(parsed.searchParams.get('client'), 'web');
    assert.deepEqual(parsed.searchParams.getAll('filter'), ['lang:en', 'symbol:NASDAQ:AMZN']);
  });

  it('custom lang is used in the first filter slot', async () => {
    const fetch = makeFetch({ total: 0, items: [] });
    await listDocuments({ symbol: 'NASDAQ:AMZN', lang: 'de', _deps: { fetch } });
    const filters = new URL(fetch.calls[0].url).searchParams.getAll('filter');
    assert.deepEqual(filters.slice(0, 2), ['lang:de', 'symbol:NASDAQ:AMZN']);
  });

  it('categories filter included when provided after lang and symbol', async () => {
    const fetch = makeFetch({ total: 0, items: [] });
    await listDocuments({
      symbol: 'NASDAQ:AMZN',
      categories: ['quarterly_report', 'annual_report'],
      _deps: { fetch },
    });
    const filters = new URL(fetch.calls[0].url).searchParams.getAll('filter');
    assert.deepEqual(filters, [
      'lang:en',
      'symbol:NASDAQ:AMZN',
      'id:quarterly_report,annual_report',
    ]);
  });

  it('categories filter omitted when not provided', async () => {
    const fetch = makeFetch({ total: 0, items: [] });
    await listDocuments({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    const url = fetch.calls[0].url;
    assert.ok(!url.includes('filter=id'), 'no id filter when categories absent');
  });

  it('converts reported (Unix seconds) to an ISO string', async () => {
    const fetch = makeFetch({ total: 1, items: [SAMPLE_ITEM] });
    const out = await listDocuments({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.equal(out.items[0].reported, new Date(1777498200 * 1000).toISOString());
    assert.match(out.items[0].reported, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('null reported → null (no conversion)', async () => {
    const item = { ...SAMPLE_ITEM, reported: undefined };
    const fetch = makeFetch({ total: 1, items: [item] });
    const out = await listDocuments({ symbol: 'X', _deps: { fetch } });
    assert.equal(out.items[0].reported, null);
  });

  it('returns items with all expected fields', async () => {
    const fetch = makeFetch({ total: 201, items: [SAMPLE_ITEM] });
    const out = await listDocuments({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.equal(out.success, true);
    assert.equal(out.symbol, 'NASDAQ:AMZN');
    assert.equal(out.total, 201);
    assert.equal(out.count, 1);

    const got = out.items[0];
    assert.equal(got.id, 'urn:report:quartr.com:123');
    assert.equal(got.title, 'Q1 2026');
    assert.equal(got.category, 'quarterly_report');
    assert.equal(got.category_title, 'Quarterly report');
    assert.equal(got.fiscal_period, 'Q1');
    assert.equal(got.fiscal_year, 2026);
    assert.equal(got.event, 'earning');
    assert.equal(got.provider, 'Quartr');
    assert.equal(got.form, '10-Q');
    assert.deepEqual(got.view_ids, [
      { id: 'urn:report:quartr.com:123-abc', type: 'pdf' },
      { id: 'urn:summary_document_report:quartr.com:456', type: 'summary' },
    ]);
  });

  it('applies limit (slice to limit)', async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...SAMPLE_ITEM, id: `i${i}` }));
    const fetch = makeFetch({ total: 50, items: many });
    const out = await listDocuments({ symbol: 'X', limit: 5, _deps: { fetch } });
    assert.equal(out.count, 5);
    assert.equal(out.items.length, 5);
  });

  it('clamps limit: 999→100, 0→1', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ ...SAMPLE_ITEM, id: `i${i}` }));
    const out999 = await listDocuments({ symbol: 'X', limit: 999, _deps: { fetch: makeFetch({ total: 150, items: many }) } });
    assert.equal(out999.count, 100, '999 clamps to 100');
    const out0 = await listDocuments({ symbol: 'X', limit: 0, _deps: { fetch: makeFetch({ total: 150, items: many }) } });
    assert.equal(out0.count, 1, '0 clamps to 1');
  });

  it('source: rest_api present in return', async () => {
    const out = await listDocuments({ symbol: 'X', _deps: { fetch: makeFetch({ total: 0, items: [] }) } });
    assert.equal(out.source, 'rest_api');
  });

  it('HTTP 503 → throws TvError(REST_HTTP, retryable: true)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 503 });
    await assert.rejects(
      () => listDocuments({ symbol: 'X', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.meta?.status, 503);
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// listDocuments — TV_MCP_REST=0
// ---------------------------------------------------------------------------
describe('listDocuments() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => listDocuments({ symbol: 'X', _deps: { fetch: makeFetch({ total: 0, items: [] }) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getDocumentFile
// ---------------------------------------------------------------------------
describe('getDocumentFile()', () => {
  it('view_id is required', async () => {
    await assert.rejects(
      () => getDocumentFile({ _deps: { evaluateAsync: makeEvalAsync({}) } }),
      /view_id is required/,
    );
  });

  it('encodes view_id in the request URL path', async () => {
    const evaluateAsync = makeEvalAsync({ url: 'https://s3.example.com/file.pdf' });
    await getDocumentFile({ view_id: 'urn:report:quartr.com:123-abc', _deps: { evaluateAsync } });
    const expr = evaluateAsync.calls[0];
    assert.ok(
      expr.includes('urn%3Areport%3Aquartr.com%3A123-abc'),
      'view_id is percent-encoded in the path',
    );
    assert.ok(expr.includes('doc-screener/v1/files/'), 'files endpoint path present');
  });

  it('200 → returns { success: true, file_available: true, data }', async () => {
    const evaluateAsync = makeEvalAsync({ url: 'https://s3.example.com/file.pdf' });
    const out = await getDocumentFile({ view_id: 'view-1', _deps: { evaluateAsync } });
    assert.equal(out.success, true);
    assert.equal(out.file_available, true);
    assert.equal(out.view_id, 'view-1');
    assert.deepEqual(out.data, { url: 'https://s3.example.com/file.pdf' });
    assert.equal(out.source, 'rest_api');
  });

  it('403 → soft-fail with entitlement message', async () => {
    const evaluateAsync = makeEvalAsync(null, { ok: false, status: 403 });
    const out = await getDocumentFile({ view_id: 'view-1', _deps: { evaluateAsync } });
    assert.equal(out.success, true);
    assert.equal(out.file_available, false);
    assert.match(out.error, /entitlement/);
  });

  it('401 → soft-fail with session-expired message', async () => {
    const evaluateAsync = makeEvalAsync(null, { ok: false, status: 401 });
    const out = await getDocumentFile({ view_id: 'view-1', _deps: { evaluateAsync } });
    assert.equal(out.success, true);
    assert.equal(out.file_available, false);
    assert.match(out.error, /session expired/);
  });

  it('500 → TvError propagated (re-thrown)', async () => {
    const evaluateAsync = makeEvalAsync(null, { ok: false, status: 500 });
    await assert.rejects(
      () => getDocumentFile({ view_id: 'view-1', _deps: { evaluateAsync } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.meta?.status, 500);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getDocumentFile — TV_MCP_REST=0
// ---------------------------------------------------------------------------
describe('getDocumentFile() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => getDocumentFile({ view_id: 'view-1', _deps: { evaluateAsync: makeEvalAsync({}) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

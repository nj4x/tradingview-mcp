import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { searchEtfs, getEtf } from '../src/core/etf.js';

const COLUMNS = ['name', 'description', 'close', 'change', 'aum', 'expense_ratio', 'asset_class.tr', 'focus.tr', 'nav_total_return.3Y', 'fund_flows.1M', 'fundamental_currency_code'];
const GET_COLUMNS = ['name', 'description', 'close', 'change', 'aum', 'expense_ratio', 'asset_class.tr', 'focus.tr', 'nav_total_return.3Y', 'fund_flows.1M'];

const VOO_ROW = {
  s: 'AMEX:VOO',
  d: ['Vanguard S&P 500 ETF', 'VOO desc', 556.8, 0.5, 956700000000, 0.03, 'Equity', 'Large cap', 12.5, 1000000000, 'USD'],
};
const VOO_GET_ROW = {
  s: 'AMEX:VOO',
  d: ['Vanguard S&P 500 ETF', 'VOO desc', 556.8, 0.5, 956700000000, 0.03, 'Equity', 'Large cap', 12.5, 1000000000],
};

/** Returns { fetch, lastBody } so tests can inspect the request body. */
function makeFetch(responseData, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, opts) => {
    assert.ok(url.includes('scanner.tradingview.com/america/scan'), `unexpected url: ${url}`);
    calls.push({ url, opts, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok, status, json: async () => responseData };
  };
  return { fetch, calls };
}

afterEach(() => { delete process.env.TV_MCP_REST; });

describe('searchEtfs()', () => {
  it('default request body has type=fund filter, correct columns, sort by aum desc', async () => {
    const { fetch, calls } = makeFetch({ totalCount: 1, data: [VOO_ROW] });
    await searchEtfs({ _deps: { fetch } });
    const body = calls[0].body;
    assert.deepEqual(body.filter, [{ left: 'type', operation: 'equal', right: 'fund' }]);
    assert.deepEqual(body.columns, COLUMNS);
    assert.deepEqual(body.sort, { sortBy: 'aum', sortOrder: 'desc' });
    assert.equal(calls[0].opts.method, 'POST');
  });

  it('with query → body includes search phrase', async () => {
    const { fetch, calls } = makeFetch({ totalCount: 1, data: [VOO_ROW] });
    await searchEtfs({ query: 'S&P 500', _deps: { fetch } });
    assert.deepEqual(calls[0].body.search, { type: 'phrase', query: 'S&P 500' });
  });

  it('without query → no search key in body', async () => {
    const { fetch, calls } = makeFetch({ totalCount: 0, data: [] });
    await searchEtfs({ _deps: { fetch } });
    assert.equal(calls[0].body.search, undefined);
  });

  it('positional zip: returned objects have named fields (not array)', async () => {
    const { fetch } = makeFetch({ totalCount: 1, data: [VOO_ROW] });
    const res = await searchEtfs({ _deps: { fetch } });
    assert.equal(res.count, 1);
    const etf = res.results[0];
    assert.equal(etf.symbol, 'AMEX:VOO');
    assert.equal(etf.name, 'Vanguard S&P 500 ETF');
    assert.equal(etf.description, 'VOO desc');
    assert.equal(etf.close, 556.8);
    assert.equal(etf.change, 0.5);
    assert.equal(etf.aum, 956700000000);
    assert.equal(etf.expense_ratio, 0.03);
    assert.equal(etf.asset_class, 'Equity');
    assert.equal(etf.focus, 'Large cap');
    assert.equal(etf.nav_return_3y, 12.5);
    assert.equal(etf.fund_flows_1m, 1000000000);
    assert.equal(etf.currency, 'USD');
  });

  it('column count mismatch → TvError', async () => {
    const badRow = { s: 'AMEX:BAD', d: ['only', 'two'] };
    const { fetch } = makeFetch({ totalCount: 1, data: [badRow] });
    await assert.rejects(
      () => searchEtfs({ _deps: { fetch } }),
      (err) => err.name === 'TvError' && err.code === 'JS_EVAL',
    );
  });

  it('empty data[] → returns empty results array (not error)', async () => {
    const { fetch } = makeFetch({ totalCount: 0, data: [] });
    const res = await searchEtfs({ _deps: { fetch } });
    assert.equal(res.success, true);
    assert.equal(res.count, 0);
    assert.deepEqual(res.results, []);
  });

  it('HTTP 429 → TvError(REST_HTTP, retryable: true)', async () => {
    const { fetch } = makeFetch(null, { ok: false, status: 429 });
    await assert.rejects(
      () => searchEtfs({ _deps: { fetch } }),
      (err) => err.name === 'TvError' && err.code === 'REST_HTTP' && err.retryable === true,
    );
  });

  it('TV_MCP_REST=0 → TvError(REST_DISABLED)', async () => {
    process.env.TV_MCP_REST = '0';
    const { fetch } = makeFetch({ totalCount: 0, data: [] });
    await assert.rejects(
      () => searchEtfs({ _deps: { fetch } }),
      (err) => err.name === 'TvError' && err.code === 'REST_DISABLED',
    );
  });

  it('custom limit → range [0, limit] in body', async () => {
    const { fetch, calls } = makeFetch({ totalCount: 0, data: [] });
    await searchEtfs({ limit: 25, _deps: { fetch } });
    assert.deepEqual(calls[0].body.range, [0, 25]);
  });

  it('limit clamps to 1-200', async () => {
    const { fetch, calls } = makeFetch({ totalCount: 0, data: [] });
    await searchEtfs({ limit: 9999, _deps: { fetch } });
    assert.deepEqual(calls[0].body.range, [0, 200]);
    const { fetch: f2, calls: c2 } = makeFetch({ totalCount: 0, data: [] });
    await searchEtfs({ limit: 0, _deps: { fetch: f2 } });
    assert.deepEqual(c2[0].body.range, [0, 1]);
  });

  it('source is rest_api', async () => {
    const { fetch } = makeFetch({ totalCount: 1, data: [VOO_ROW] });
    const res = await searchEtfs({ _deps: { fetch } });
    assert.equal(res.source, 'rest_api');
  });
});

describe('getEtf()', () => {
  it('correct request body with symbols.tickers', async () => {
    const { fetch, calls } = makeFetch({ totalCount: 1, data: [VOO_GET_ROW] });
    await getEtf({ symbol: 'AMEX:VOO', _deps: { fetch } });
    const body = calls[0].body;
    assert.deepEqual(body.symbols, { tickers: ['AMEX:VOO'] });
    assert.deepEqual(body.columns, GET_COLUMNS);
    assert.equal(calls[0].opts.method, 'POST');
  });

  it('returns single record with named fields', async () => {
    const { fetch } = makeFetch({ totalCount: 1, data: [VOO_GET_ROW] });
    const res = await getEtf({ symbol: 'AMEX:VOO', _deps: { fetch } });
    assert.equal(res.success, true);
    assert.equal(res.source, 'rest_api');
    assert.ok(!Array.isArray(res.etf));
    assert.equal(res.etf.symbol, 'AMEX:VOO');
    assert.equal(res.etf.name, 'Vanguard S&P 500 ETF');
    assert.equal(res.etf.expense_ratio, 0.03);
    assert.equal(res.etf.fund_flows_1m, 1000000000);
  });

  it('empty data[] → throws TvError(JS_EVAL)', async () => {
    const { fetch } = makeFetch({ totalCount: 0, data: [] });
    await assert.rejects(
      () => getEtf({ symbol: 'AMEX:NOPE', _deps: { fetch } }),
      (err) => err.name === 'TvError' && err.code === 'JS_EVAL',
    );
  });

  it('column count mismatch → throws TvError', async () => {
    const badRow = { s: 'AMEX:BAD', d: ['only', 'two'] };
    const { fetch } = makeFetch({ totalCount: 1, data: [badRow] });
    await assert.rejects(
      () => getEtf({ symbol: 'AMEX:BAD', _deps: { fetch } }),
      (err) => err.name === 'TvError' && err.code === 'JS_EVAL',
    );
  });

  it('missing symbol throws', async () => {
    const { fetch } = makeFetch({ totalCount: 0, data: [] });
    await assert.rejects(() => getEtf({ _deps: { fetch } }), /symbol is required/);
  });

  it('TV_MCP_REST=0 → TvError(REST_DISABLED)', async () => {
    process.env.TV_MCP_REST = '0';
    const { fetch } = makeFetch({ totalCount: 1, data: [VOO_GET_ROW] });
    await assert.rejects(
      () => getEtf({ symbol: 'AMEX:VOO', _deps: { fetch } }),
      (err) => err.name === 'TvError' && err.code === 'REST_DISABLED',
    );
  });
});

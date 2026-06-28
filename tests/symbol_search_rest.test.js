import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { symbolSearch } from '../src/core/chart.js';

describe('symbolSearch() via restFromNode DI', () => {
  function makeFetch(symbols = []) {
    return async (url, _opts) => ({
      ok: true,
      json: async () => ({ symbols }),
    });
  }

  it('passes the query and type in the URL', async () => {
    let capturedUrl = '';
    const fetch = async (url) => { capturedUrl = url; return { ok: true, json: async () => ({ symbols: [] }) }; };
    await symbolSearch({ query: 'AAPL', type: 'stock', _deps: { fetch } });
    assert.ok(capturedUrl.includes('AAPL'), 'URL should contain the query');
    assert.ok(capturedUrl.includes('stock'), 'URL should contain the type');
  });

  it('strips <em> tags from symbol names', async () => {
    const fetch = makeFetch([{ symbol: 'AAPL', description: '<em>App</em>le', type: 'stock', exchange: 'NASDAQ', full_name: 'NASDAQ:<em>AAPL</em>' }]);
    const res = await symbolSearch({ query: 'AAPL', _deps: { fetch } });
    assert.ok(!res.results[0].description.includes('<em>'), 'em tags should be stripped');
    assert.ok(!res.results[0].full_name.includes('<em>'), 'em tags in full_name should be stripped');
  });

  it('caps results at 15', async () => {
    const symbols = Array.from({ length: 20 }, (_, i) => ({ symbol: `SYM${i}`, description: '', type: 'stock', exchange: 'X', full_name: `X:SYM${i}` }));
    const fetch = makeFetch(symbols);
    const res = await symbolSearch({ query: 'SYM', _deps: { fetch } });
    assert.equal(res.results.length, 15);
    assert.equal(res.count, 15);
  });

  it('returns source: rest_api', async () => {
    const fetch = makeFetch([]);
    const res = await symbolSearch({ query: 'X', _deps: { fetch } });
    assert.equal(res.source, 'rest_api');
  });

  it('propagates REST_HTTP error on non-ok response', async () => {
    const fetch = async () => ({ ok: false, status: 503 });
    await assert.rejects(() => symbolSearch({ query: 'X', _deps: { fetch } }), (err) => {
      assert.equal(err.code, 'REST_HTTP');
      assert.equal(err.meta.status, 503);
      return true;
    });
  });
});

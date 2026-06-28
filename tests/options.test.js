import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchContracts } from '../src/core/options.js';

describe('searchContracts() — tier-1 restFromNode', () => {
  function makeFetch(symbols = []) {
    return async () => ({ ok: true, status: 200, json: async () => ({ symbols }) });
  }

  it('tier-1 returns source:rest_api when fetch succeeds', async () => {
    const fetch = makeFetch([
      { symbol: 'AAPL250117C00200000', description: 'AAPL Call', type: 'option', exchange: 'OPRA' },
    ]);
    // tier-2 evaluateAsync returns a raw array (renderer fallback shape); should NOT be reached.
    const evaluateAsync = async () => [];
    const res = await searchContracts({ underlying: 'AAPL', _deps: { fetch, evaluateAsync } });
    assert.equal(res.success, true);
    assert.equal(res.source, 'rest_api');
    assert.equal(res.count, 1);
    assert.equal(res.contracts[0].symbol, 'AAPL250117C00200000');
    assert.equal(res.contracts[0].contract_type, 'call');
  });

  it('tier-1 fetch throwing degrades to tier-2', async () => {
    const fetch = async () => { throw new Error('network error'); };
    const evaluateAsync = async (_expr) => ([
      { symbol: 'TIER2C00010000', description: 'fallback', type: 'option', exchange: 'X' },
    ]);
    const res = await searchContracts({ underlying: 'AAPL', _deps: { fetch, evaluateAsync } });
    assert.equal(res.success, true);
    assert.equal(res.source, 'searchSymbols');
    assert.equal(res.count, 1);
    assert.equal(res.contracts[0].symbol, 'TIER2C00010000');
  });

  it('tier-1 non-ok response (restFromNode throws REST_HTTP) degrades to tier-2', async () => {
    const fetch = async () => ({ ok: false, status: 503 });
    const evaluateAsync = async (_expr) => ([
      { symbol: 'TIER2P00020000', description: 'fallback', type: 'option', exchange: 'X' },
    ]);
    const res = await searchContracts({ underlying: 'AAPL', _deps: { fetch, evaluateAsync } });
    assert.equal(res.success, true);
    assert.equal(res.source, 'searchSymbols');
    assert.equal(res.count, 1);
  });

  it('tier-1 empty results degrade to tier-2', async () => {
    const fetch = makeFetch([]);
    const evaluateAsync = async (_expr) => ([
      { symbol: 'EMPTYFALLBACKC00030000', description: 'fb', type: 'option', exchange: 'X' },
    ]);
    const res = await searchContracts({ underlying: 'AAPL', _deps: { fetch, evaluateAsync } });
    assert.equal(res.success, true);
    assert.equal(res.source, 'searchSymbols');
    assert.equal(res.count, 1);
  });

  it('tier-2 renderer error propagates as a thrown Error', async () => {
    const fetch = async () => { throw new Error('network error'); };
    const evaluateAsync = async (_expr) => ({ __error: 'renderer boom' });
    await assert.rejects(
      () => searchContracts({ underlying: 'AAPL', _deps: { fetch, evaluateAsync } }),
      /renderer boom/,
    );
  });

  it('missing underlying throws', async () => {
    await assert.rejects(() => searchContracts({ _deps: { fetch: makeFetch(), evaluateAsync: async () => [] } }), /underlying is required/);
  });
});

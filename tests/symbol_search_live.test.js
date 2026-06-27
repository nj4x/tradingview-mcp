/**
 * Tests for symbolSearchLive — in-renderer searchSymbols API, offline DI mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { symbolSearchLive } from '../src/core/chart.js';

function mockEval(returnValue) {
  const calls = [];
  const fn = async (expr) => { calls.push(expr); return returnValue; };
  fn.calls = calls;
  return fn;
}

describe('symbolSearchLive()', () => {
  it('escapes the query and strips <em> highlight tags', async () => {
    const mock = mockEval([
      { symbol: 'AAPL', description: '<em>Apple</em> Inc', type: 'stock', exchange: 'NASDAQ', currency_code: 'USD' },
    ]);
    const res = await symbolSearchLive({ query: 'AAPL', _deps: { evaluateAsync: mock } });
    assert.ok(mock.calls[0].includes('searchSymbols({ text: "AAPL" })'));
    assert.equal(res.results[0].description, 'Apple Inc');
    assert.equal(res.results[0].symbol, 'AAPL');
    assert.equal(res.count, 1);
    assert.equal(res.source, 'searchSymbols');
  });

  it('neutralizes injection — dangerous query never appears raw', async () => {
    const evil = '"]});evil(//';
    const mock = mockEval([]);
    await symbolSearchLive({ query: evil, _deps: { evaluateAsync: mock } });
    const expr = mock.calls[0];
    assert.ok(!expr.includes(`text: ${evil}`));
    assert.ok(!expr.includes(`text: "]});evil(//"`));
    assert.ok(expr.includes(`text: "\\"]});evil(//"`));
  });

  it('throws on empty query', async () => {
    await assert.rejects(symbolSearchLive({ query: '' }), /query is required/);
  });

  it('caps results at 15', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ symbol: `S${i}`, description: `d${i}` }));
    const mock = mockEval(many);
    const res = await symbolSearchLive({ query: 'x', _deps: { evaluateAsync: mock } });
    assert.equal(res.results.length, 15);
    assert.equal(res.count, 15);
  });

  it('propagates __error from the renderer', async () => {
    const mock = mockEval({ __error: 'boom' });
    await assert.rejects(symbolSearchLive({ query: 'x', _deps: { evaluateAsync: mock } }), /boom/);
  });
});

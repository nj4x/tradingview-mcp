/**
 * Offline unit tests for the REST path of watchlist.get().
 *
 * Verifies:
 * 1. REST happy-path — active list found → canonical shape returned.
 * 2. REST fallback logic — first list used when none is flagged active.
 * 3. Null/empty REST response → symbols:[].
 * 4. Auto-fallback to CDP when REST throws (TV_MCP_REST is not disabled).
 * 5. TV_MCP_REST=0 forces CDP path (existing panel tests cover this in depth;
 *    here we verify the guard flag is respected).
 *
 * All tests run offline via DI (_deps: { evaluate, evaluateAsync }).
 * Run: node --test tests/watchlist_rest.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core/watchlist.js';

// Ensure REST is enabled for these tests (clear any inherited =0 flag).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/**
 * Builds a mock evaluateAsync that returns the REST envelope on the first
 * call (which buildFetchExpr generates). The second call, if any, returns
 * undefined (used for CDP fallback polling — should not be reached in REST tests).
 */
function makeRestEvaluateAsync(data, { ok = true, status = 200 } = {}) {
  let called = 0;
  return async (_expr) => {
    called++;
    if (called === 1) {
      // Return the envelope that restFromRenderer expects
      return { __ok: ok, status, data };
    }
    // Should not be called again unless falling back to CDP async poll
    return undefined;
  };
}

function makeRestEvaluateAsyncError(errorMsg) {
  return async (_expr) => ({ __error: errorMsg });
}

// Dummy evaluate for when CDP path is not expected to be exercised
const noEvaluate = async () => { throw new Error('evaluate() should not be called in REST path'); };

// ---------------------------------------------------------------------------
// 1. Happy path: active list found
// ---------------------------------------------------------------------------
describe('watchlist.get() REST path — active list returns symbols', () => {
  it('returns success=true, source=rest_api, correct count and symbols', async () => {
    const restData = [
      { id: 1, name: 'My Watchlist', active: true, symbols: ['NASDAQ:AAPL', 'NASDAQ:MSFT', 'AMEX:SPY'] },
      { id: 2, name: 'Futures', active: false, symbols: ['CME_MINI:ES1!'] },
    ];
    const evaluateAsync = makeRestEvaluateAsync(restData);

    const result = await core.get({ _deps: { evaluate: noEvaluate, evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.source, 'rest_api');
    assert.equal(result.count, 3);
    assert.equal(result.list_name, 'My Watchlist');
    assert.equal(result.symbols.length, 3);
    assert.equal(result.symbols[0].symbol, 'NASDAQ:AAPL');
    assert.equal(result.symbols[0].last, null, 'REST path has no price data');
    assert.equal(result.symbols[0].change, null);
    assert.equal(result.symbols[0].change_percent, null);
    assert.equal(result.symbols[2].symbol, 'AMEX:SPY');
  });
});

// ---------------------------------------------------------------------------
// 2. No list flagged active — fall back to first list
// ---------------------------------------------------------------------------
describe('watchlist.get() REST path — no active flag: uses first list', () => {
  it('picks the first list and returns its symbols', async () => {
    const restData = [
      { id: 1, name: 'First List', active: false, symbols: ['NYSE:IBM', 'NYSE:GE'] },
      { id: 2, name: 'Second List', active: false, symbols: ['NASDAQ:GOOG'] },
    ];
    const evaluateAsync = makeRestEvaluateAsync(restData);

    const result = await core.get({ _deps: { evaluate: noEvaluate, evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.equal(result.list_name, 'First List');
    assert.equal(result.symbols[0].symbol, 'NYSE:IBM');
  });
});

// ---------------------------------------------------------------------------
// 3. Empty symbols array in response
// ---------------------------------------------------------------------------
describe('watchlist.get() REST path — active list with no symbols', () => {
  it('returns count=0 and empty symbols array', async () => {
    const restData = [{ id: 1, name: 'Empty', active: true, symbols: [] }];
    const evaluateAsync = makeRestEvaluateAsync(restData);

    const result = await core.get({ _deps: { evaluate: noEvaluate, evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.count, 0);
    assert.deepEqual(result.symbols, []);
  });
});

// ---------------------------------------------------------------------------
// 4. Empty REST response (null / empty array)
// ---------------------------------------------------------------------------
describe('watchlist.get() REST path — null REST response', () => {
  it('falls back to CDP when REST returns null', async () => {
    // REST returns null → restFromRenderer returns null → _getViaRest throws
    // The fallback CDP path will be used; mock it to succeed.
    const evaluateAsync = async (_expr) => {
      // First call is the REST fetch — return null envelope to trigger error
      if (_expr.includes('fetch(')) return null; // null → "no response from renderer"
      // Second call (CDP fallback async poll) shouldn't happen if the CDP evaluate mocks are set
      return true;
    };

    // CDP fallback path: panel check + symbol read
    let cdpCall = 0;
    const evaluate = async (_expr) => {
      cdpCall++;
      if (cdpCall === 1) return { clicked: false };  // panel already open
      return { symbols: [{ symbol: 'CDP:FALLBACK', last: null, change: null, change_percent: null }], source: 'data_attributes' };
    };

    const result = await core.get({ _deps: { evaluate, evaluateAsync } });

    // Should have fallen back to CDP
    assert.equal(result.success, true);
    assert.ok(result.symbols.some(s => s.symbol === 'CDP:FALLBACK'), 'should have CDP fallback symbols');
  });
});

// ---------------------------------------------------------------------------
// 5. REST throws HTTP error → auto-fallback to CDP
// ---------------------------------------------------------------------------
describe('watchlist.get() REST path — HTTP 401 triggers CDP fallback', () => {
  it('falls back to CDP on REST HTTP error', async () => {
    let callIndex = 0;
    const evaluateAsync = async (_expr) => {
      callIndex++;
      if (callIndex === 1) {
        // First call: REST fetch returns 401
        return { __ok: false, status: 401, data: null };
      }
      // CDP async poll (if clicked): return true (opened)
      return true;
    };

    let cdpEvalCall = 0;
    const evaluate = async (_expr) => {
      cdpEvalCall++;
      if (cdpEvalCall === 1) return { clicked: false }; // panel already open
      return { symbols: [{ symbol: 'CDP:RECOVERED', last: null, change: null, change_percent: null }], source: 'data_attributes' };
    };

    const result = await core.get({ _deps: { evaluate, evaluateAsync } });

    assert.equal(result.success, true);
    assert.ok(result.symbols.some(s => s.symbol === 'CDP:RECOVERED'), 'should have CDP fallback symbols');
  });
});

// ---------------------------------------------------------------------------
// 6. TV_MCP_REST=0 routes to CDP, never calls REST fetch
// ---------------------------------------------------------------------------
describe('watchlist.get() — TV_MCP_REST=0 forces CDP path', () => {
  it('uses CDP and never calls the REST fetch expression', async () => {
    process.env.TV_MCP_REST = '0';
    try {
      // evaluateAsync should NOT be called with a fetch expression when REST is disabled
      const evaluateAsync = async (expr) => {
        if (expr && expr.includes('fetch(')) {
          throw new Error('REST fetch should not be called when TV_MCP_REST=0');
        }
        // Allow CDP polling calls
        return true;
      };

      let cdpCall = 0;
      const evaluate = async (_expr) => {
        cdpCall++;
        if (cdpCall === 1) return { clicked: false };
        return { symbols: [{ symbol: 'CDPONLY', last: null, change: null, change_percent: null }], source: 'data_attributes' };
      };

      const result = await core.get({ _deps: { evaluate, evaluateAsync } });
      assert.equal(result.success, true);
      assert.equal(result.symbols[0].symbol, 'CDPONLY');
    } finally {
      delete process.env.TV_MCP_REST;
    }
  });
});

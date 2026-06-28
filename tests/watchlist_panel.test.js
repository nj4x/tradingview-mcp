/**
 * Verifies the CDP DOM path of watchlist.get() (TV_MCP_REST=0 forces it).
 *
 * watchlist.get() is REST-first when TV_MCP_REST is not "0". These tests cover
 * the legacy CDP path by overriding the env flag, so the DOM-scraping logic and
 * _ensureWatchlistOpen behavior can be verified offline via DI.
 *
 * _ensureWatchlistOpen:
 *   1. calls evaluate() once to check the button state (and click if closed)
 *   2. if it clicked, calls evaluateAsync() once to poll until the sidebar is open
 * Then get() calls evaluate() again to read the symbol list.
 *
 * All tests run offline via DI (_deps: { evaluate, evaluateAsync }).
 * Run: node --test tests/watchlist_panel.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core/watchlist.js';

// Force the CDP path for all tests in this file.
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/**
 * Build an ordered-response mock for evaluate and evaluateAsync.
 * Each queue entry is consumed in FIFO order; if the queue is exhausted
 * an error is thrown so tests fail loudly instead of silently returning undefined.
 */
function makeQueue({ evaluateResponses = [], evaluateAsyncResponses = [] } = {}) {
  const evaluateCalls = [];
  const evaluateAsyncCalls = [];

  const evaluate = async (expr) => {
    evaluateCalls.push(expr);
    if (evaluateResponses.length === 0) {
      throw new Error(
        `evaluate() called more times than expected (call #${evaluateCalls.length}). expr: ${expr.slice(0, 80)}`,
      );
    }
    return evaluateResponses.shift();
  };

  const evaluateAsync = async (expr) => {
    evaluateAsyncCalls.push(expr);
    if (evaluateAsyncResponses.length === 0) {
      throw new Error(
        `evaluateAsync() called more times than expected (call #${evaluateAsyncCalls.length}). expr: ${expr.slice(0, 80)}`,
      );
    }
    return evaluateAsyncResponses.shift();
  };

  return { evaluate, evaluateAsync, evaluateCalls, evaluateAsyncCalls };
}

// ---------------------------------------------------------------------------
// 1. Panel closed — opens first, then reads symbols
// ---------------------------------------------------------------------------
describe('watchlist.get() — panel closed: opens then reads symbols', () => {
  it('calls evaluate twice and evaluateAsync once; returns the symbol list', async () => {
    const { evaluate, evaluateAsync, evaluateCalls, evaluateAsyncCalls } = makeQueue({
      evaluateResponses: [
        // call 1 — _ensureWatchlistOpen: panel was closed, button clicked
        { clicked: true },
        // call 2 — read symbols
        {
          symbols: [
            { symbol: 'AAPL', last: '196.00', change: '+1.20', change_percent: '+0.62%' },
          ],
          source: 'data_attributes',
        },
      ],
      evaluateAsyncResponses: [
        // poll 1 — sidebar opened successfully
        true,
      ],
    });

    const result = await core.get({ _deps: { evaluate, evaluateAsync } });

    assert.equal(result.success, true, 'success should be true');
    assert.equal(result.count, 1, 'count should be 1');
    assert.equal(result.symbols[0].symbol, 'AAPL', 'first symbol should be AAPL');

    assert.ok(
      evaluateCalls.length >= 2,
      `evaluate should be called at least 2 times (panel-check + read), got ${evaluateCalls.length}`,
    );
    assert.equal(
      evaluateAsyncCalls.length,
      1,
      'evaluateAsync should be called exactly once for polling',
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Panel already open — reads without extra click
// ---------------------------------------------------------------------------
describe('watchlist.get() — panel already open: reads without clicking', () => {
  it('skips evaluateAsync and returns symbols directly', async () => {
    const { evaluate, evaluateAsync, evaluateCalls, evaluateAsyncCalls } = makeQueue({
      evaluateResponses: [
        // call 1 — panel already open, no click needed
        { clicked: false },
        // call 2 — read symbols
        {
          symbols: [
            { symbol: 'ES1!', last: null, change: null, change_percent: null },
          ],
          source: 'text_scan',
        },
      ],
      // no evaluateAsync responses — should not be called
      evaluateAsyncResponses: [],
    });

    const result = await core.get({ _deps: { evaluate, evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.count, 1);
    assert.equal(
      evaluateAsyncCalls.length,
      0,
      'evaluateAsync must NOT be called when panel was already open',
    );
    assert.ok(evaluateCalls.length >= 2, 'evaluate should still be called for panel-check + read');
  });
});

// ---------------------------------------------------------------------------
// 3. Watchlist button not found — throws
// ---------------------------------------------------------------------------
describe('watchlist.get() — button not found: rejects with error message', () => {
  it('rejects with /Watchlist button not found/', async () => {
    const { evaluate, evaluateAsync } = makeQueue({
      evaluateResponses: [
        // call 1 — button missing
        { error: 'Watchlist button not found' },
      ],
      evaluateAsyncResponses: [],
    });

    await assert.rejects(
      () => core.get({ _deps: { evaluate, evaluateAsync } }),
      /Watchlist button not found/,
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Panel opened but never becomes visible — throws
// ---------------------------------------------------------------------------
describe('watchlist.get() — panel opened but poll timed out: rejects', () => {
  it('rejects with /did not open within timeout/', async () => {
    const { evaluate, evaluateAsync } = makeQueue({
      evaluateResponses: [
        // call 1 — panel was closed, clicked
        { clicked: true },
      ],
      evaluateAsyncResponses: [
        // poll 1 — sidebar never opened (timeout)
        false,
      ],
    });

    await assert.rejects(
      () => core.get({ _deps: { evaluate, evaluateAsync } }),
      /did not open within timeout/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. True empty watchlist (panel already open)
// ---------------------------------------------------------------------------
describe('watchlist.get() — empty watchlist', () => {
  it('returns success=true, count=0, source="empty"', async () => {
    const { evaluate, evaluateAsync } = makeQueue({
      evaluateResponses: [
        // call 1 — panel already open
        { clicked: false },
        // call 2 — no symbols
        { symbols: [], source: 'empty' },
      ],
      evaluateAsyncResponses: [],
    });

    const result = await core.get({ _deps: { evaluate, evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.count, 0);
    assert.equal(result.source, 'empty');
    assert.deepEqual(result.symbols, []);
  });
});

// ---------------------------------------------------------------------------
// 6. data_attributes parsing preserved with multiple symbols
// ---------------------------------------------------------------------------
describe('watchlist.get() — data_attributes: multiple symbols returned correctly', () => {
  it('returns count=2 with both symbols intact', async () => {
    const { evaluate, evaluateAsync } = makeQueue({
      evaluateResponses: [
        // call 1 — panel already open
        { clicked: false },
        // call 2 — two symbols via data_attributes
        {
          symbols: [
            { symbol: 'NVDA', last: '870', change: '-5', change_percent: '-0.57%' },
            { symbol: 'MSFT', last: '420', change: null, change_percent: null },
          ],
          source: 'data_attributes',
        },
      ],
      evaluateAsyncResponses: [],
    });

    const result = await core.get({ _deps: { evaluate, evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.count, 2);
    assert.equal(result.source, 'data_attributes');

    const nvda = result.symbols.find((s) => s.symbol === 'NVDA');
    assert.ok(nvda, 'NVDA should be present');
    assert.equal(nvda.last, '870');
    assert.equal(nvda.change, '-5');
    assert.equal(nvda.change_percent, '-0.57%');

    const msft = result.symbols.find((s) => s.symbol === 'MSFT');
    assert.ok(msft, 'MSFT should be present');
    assert.equal(msft.last, '420');
    assert.equal(msft.change, null);
    assert.equal(msft.change_percent, null);
  });
});

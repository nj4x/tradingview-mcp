/**
 * Verifies _deps dependency injection in src/core/data.js.
 * Offline: injects a mock evaluate() and asserts it is used instead of the
 * module-level connection import. Run: node --test tests/data_deps.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getOhlcv } from '../src/core/data.js';

describe('data.js _deps injection', () => {
  it('getOhlcv uses the injected evaluate and returns its data', async () => {
    const calls = [];
    const mockEval = async (expr) => {
      calls.push(expr);
      return {
        bars: [
          { time: 1, open: 10, high: 12, low: 9, close: 11, volume: 100 },
          { time: 2, open: 11, high: 13, low: 10, close: 12, volume: 200 },
        ],
        total_bars: 2,
        source: 'direct_bars',
      };
    };

    const result = await getOhlcv({ _deps: { evaluate: mockEval } });

    assert.equal(calls.length, 1, 'injected evaluate should be called exactly once');
    assert.ok(calls[0].includes('lastIndex'), 'expression should be the OHLCV extraction JS');
    assert.equal(result.success, true);
    assert.equal(result.bar_count, 2);
    assert.equal(result.source, 'direct_bars');
  });

  it('getOhlcv summary path also runs through the injected evaluate', async () => {
    let called = false;
    const mockEval = async () => {
      called = true;
      return {
        bars: [{ time: 1, open: 10, high: 15, low: 8, close: 12, volume: 50 }],
        total_bars: 1,
        source: 'direct_bars',
      };
    };

    const result = await getOhlcv({ summary: true, _deps: { evaluate: mockEval } });

    assert.equal(called, true, 'injected evaluate should be used in summary path');
    assert.equal(result.success, true);
    assert.equal(result.high, 15);
    assert.equal(result.low, 8);
  });
});

/**
 * Phase 2 tools — offline DI mock tests.
 * Covers: isoToUnix (date coercion), fetchOhlcv (chart_fetch_ohlcv),
 * deploy (pine_deploy), getMarketStatus (market_status).
 * Run: node --test tests/phase2.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isoToUnix } from '../src/core/utils.js';
import { fetchOhlcv, getMarketStatus, scrollToDate, setVisibleRange, symbolInfo } from '../src/core/chart.js';
import { deploy } from '../src/core/pine.js';

describe('isoToUnix() — date coercion', () => {
  it('passes numbers through unchanged', () => {
    assert.equal(isoToUnix(1736899200), 1736899200);
    assert.equal(isoToUnix(1736899200000), 1736899200000);
    assert.equal(isoToUnix(0), 0);
  });

  it('passes numeric/digit strings through via Number (backward-compat)', () => {
    assert.equal(isoToUnix('1736899200'), 1736899200);
    assert.equal(isoToUnix('1736899200000'), 1736899200000);
  });

  it('converts ISO date strings to unix seconds', () => {
    // 2025-01-15T00:00:00Z = 1736899200
    assert.equal(isoToUnix('2025-01-15'), 1736899200);
    assert.equal(isoToUnix('2025-01-15T00:00:00Z'), 1736899200);
  });

  it('returns NaN for invalid date strings', () => {
    assert.ok(Number.isNaN(isoToUnix('not-a-date')));
  });
});

describe('scrollToDate() — ISO coercion via isoToUnix', () => {
  it('accepts ISO strings and centers on the converted unix timestamp', async () => {
    const evaluate = async (expr) => {
      if (expr.includes('.resolution()')) return 'D';
      return null;
    };
    const res = await scrollToDate({ date: '2025-01-15', _deps: { evaluate } });
    assert.equal(res.success, true);
    assert.equal(res.centered_on, 1736899200);
  });

  it('rejects unparseable dates', async () => {
    const evaluate = async () => 'D';
    await assert.rejects(() => scrollToDate({ date: 'garbage', _deps: { evaluate } }), /Could not parse date/);
  });
});

describe('setVisibleRange() — ISO coercion via isoToUnix', () => {
  it('coerces ISO from/to into unix seconds before zooming', async () => {
    let captured = '';
    const evaluate = async (expr) => {
      if (expr.includes('zoomToBarsRange')) captured = expr;
      if (expr.includes('getVisibleRange')) return { from: 1, to: 2 };
      return undefined;
    };
    const res = await setVisibleRange({ from: '2025-01-15', to: '2025-01-20', _deps: { evaluate } });
    assert.equal(res.success, true);
    // The zoom expr interpolates the coerced unix-second values.
    assert.ok(captured.includes('1736899200'), 'from coerced to unix seconds');
    assert.ok(captured.includes('1737331200'), 'to coerced to unix seconds');
  });
});

describe('fetchOhlcv() — chart_fetch_ohlcv', () => {
  function makeDeps({ symbol = 'AAPL', resolution = 'D' } = {}) {
    const calls = { setSymbol: 0, setResolution: 0, getOhlcv: 0 };
    const evaluate = async (expr) => {
      if (expr.includes('chart.symbol()') && expr.includes('chart.resolution()')) {
        return { symbol, resolution };
      }
      if (expr.includes('chart.setResolution')) { calls.setResolution++; return undefined; }
      if (expr.includes('var bars =')) { calls.getOhlcv++; return { bars: [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 5 }], total_bars: 1 }; }
      return undefined;
    };
    const evaluateAsync = async (expr) => {
      if (expr.includes('setSymbol')) { calls.setSymbol++; return undefined; }
      return undefined;
    };
    const waitForChartReady = async () => true;
    return { calls, _deps: { evaluate, evaluateAsync, waitForChartReady } };
  }

  it('skips setSymbol when the requested symbol equals the current symbol', async () => {
    const { calls, _deps } = makeDeps({ symbol: 'AAPL', resolution: 'D' });
    const res = await fetchOhlcv({ symbol: 'AAPL', _deps });
    assert.equal(calls.setSymbol, 0, 'setSymbol should be skipped');
    assert.equal(res.symbol_changed, false);
    assert.equal(res.success, true);
    assert.equal(res.bar_count, 1);
  });

  it('calls setSymbol when the symbol differs', async () => {
    const { calls, _deps } = makeDeps({ symbol: 'AAPL', resolution: 'D' });
    const res = await fetchOhlcv({ symbol: 'MSFT', _deps });
    assert.equal(calls.setSymbol, 1, 'setSymbol should run');
    assert.equal(res.symbol_changed, true);
  });

  it('skips setResolution when the timeframe matches', async () => {
    const { calls, _deps } = makeDeps({ symbol: 'AAPL', resolution: 'D' });
    const res = await fetchOhlcv({ symbol: 'AAPL', timeframe: 'D', _deps });
    assert.equal(calls.setResolution, 0, 'setResolution should be skipped');
    assert.equal(res.timeframe_changed, false);
    assert.equal(res.timeframe, 'D');
  });

  it('calls setResolution when the timeframe differs', async () => {
    const { calls, _deps } = makeDeps({ symbol: 'AAPL', resolution: 'D' });
    const res = await fetchOhlcv({ symbol: 'AAPL', timeframe: '60', _deps });
    assert.equal(calls.setResolution, 1, 'setResolution should run');
    assert.equal(res.timeframe_changed, true);
    assert.equal(res.timeframe, '60');
  });

  it('caps the bar count via getOhlcv (count passes through to limit)', async () => {
    let limitSeen = null;
    const evaluate = async (expr) => {
      if (expr.includes('chart.symbol()') && expr.includes('chart.resolution()')) return { symbol: 'AAPL', resolution: 'D' };
      if (expr.includes('var bars =')) {
        const m = expr.match(/end - (\d+) \+ 1/);
        if (m) limitSeen = Number(m[1]);
        return { bars: [], total_bars: 0 };
      }
      return undefined;
    };
    const _deps = { evaluate, evaluateAsync: async () => undefined, waitForChartReady: async () => true };
    // getOhlcv throws on empty bars — that is fine, we just need to observe the cap.
    await assert.rejects(() => fetchOhlcv({ symbol: 'AAPL', count: 9999, _deps }));
    assert.equal(limitSeen, 500, 'count should be capped at MAX_OHLCV_BARS (500)');
  });

  it('requires a symbol', async () => {
    await assert.rejects(() => fetchOhlcv({ _deps: { evaluate: async () => ({}) } }), /symbol is required/);
  });

  it('stamps hint only after successful setSymbol (not before)', async () => {
    const order = [];
    // Current symbol differs → a switch must happen before the hint is recorded.
    const evaluate = async (expr) => {
      if (expr.includes('chart.symbol()') && expr.includes('chart.resolution()')) {
        return { symbol: 'AAPL', resolution: 'D' };
      }
      if (expr.includes('var bars =')) {
        return { bars: [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 5 }], total_bars: 1 };
      }
      return undefined;
    };
    const evaluateAsync = async (expr) => {
      if (expr.includes('setSymbol')) order.push('setSymbol');
      return undefined;
    };
    const waitForChartReady = async () => true;
    const setSymbolHint = () => { order.push('setSymbolHint'); };

    const res = await fetchOhlcv({ symbol: 'MSFT', _deps: { evaluate, evaluateAsync, waitForChartReady, setSymbolHint } });
    assert.equal(res.symbol_changed, true);
    // The hint must be stamped only AFTER the symbol switch completes.
    const switchIdx = order.indexOf('setSymbol');
    const hintIdx = order.indexOf('setSymbolHint');
    assert.ok(switchIdx >= 0, 'setSymbol was invoked');
    assert.ok(hintIdx >= 0, 'setSymbolHint was invoked');
    assert.ok(hintIdx > switchIdx, 'setSymbolHint is called AFTER setSymbol, not before');
  });

  it('does NOT stamp hint when setSymbol throws', async () => {
    let hintCalls = 0;
    const evaluate = async (expr) => {
      if (expr.includes('chart.symbol()') && expr.includes('chart.resolution()')) {
        return { symbol: 'AAPL', resolution: 'D' };
      }
      return undefined;
    };
    // setSymbol's underlying evaluateAsync throws → the switch fails.
    const evaluateAsync = async (expr) => {
      if (expr.includes('setSymbol')) throw new Error('boom: setSymbol failed');
      return undefined;
    };
    const waitForChartReady = async () => true;
    const setSymbolHint = () => { hintCalls++; };

    await assert.rejects(
      () => fetchOhlcv({ symbol: 'MSFT', _deps: { evaluate, evaluateAsync, waitForChartReady, setSymbolHint } }),
      /setSymbol failed/,
    );
    assert.equal(hintCalls, 0, 'setSymbolHint never called when the switch throws');
  });
});

describe('deploy() — pine_deploy', () => {
  function makeDeps({ markers = [], console = [] } = {}) {
    const calls = { findMonaco: 0, setValue: 0, getValue: 0, getMarkers: 0, buttonClick: 0 };
    const evaluate = async (expr) => {
      // ensurePineEditorOpen's "already open?" probe — match the FIND_MONACO probe markers only.
      if (expr.includes('return m !== null') || expr.includes('findMonacoEditor')) {
        if (expr.includes('return m !== null') && !expr.includes('m.editor')) {
          calls.findMonaco++;
          return true; // editor already open → opened exactly once, no DOM clicks
        }
      }
      if (expr.includes('m.editor.setValue')) { calls.setValue++; return true; }
      if (expr.includes('getModelMarkers')) { calls.getMarkers++; return markers; }
      // compile()'s button finder — pretend a compile button was clicked (avoids getClient fallback).
      if (expr.includes('save and add to chart') || expr.includes('Add to chart')) { calls.buttonClick++; return 'Add to chart'; }
      if (expr.includes('consoleRow') || expr.includes('results.push')) return console;
      return undefined;
    };
    const evaluateAsync = async () => undefined;
    return { calls, _deps: { evaluate, evaluateAsync } };
  }

  it('opens the editor exactly once and returns merged shape (no save)', async () => {
    const { calls, _deps } = makeDeps();
    const res = await deploy({ source: '//@version=6\nindicator("x")\nplot(close)', _deps });
    // ensurePineEditorOpen probes once at the top; sub-calls skip the open.
    assert.equal(calls.findMonaco, 1, 'editor opened/probed exactly once');
    assert.equal(calls.setValue, 1, 'source set once');
    assert.equal(res.success, true);
    assert.equal(res.compiled, true);
    assert.deepEqual(res.errors, []);
    assert.ok(Array.isArray(res.console_output));
    assert.equal(res.saved, false);
  });

  it('reports compiled=false and surfaces errors when markers exist', async () => {
    const markers = [{ startLineNumber: 2, startColumn: 1, message: 'syntax error', severity: 8 }];
    const { _deps } = makeDeps({ markers });
    const res = await deploy({ source: 'bad', _deps });
    assert.equal(res.compiled, false);
    assert.equal(res.error_count, 1);
    assert.equal(res.errors[0].message, 'syntax error');
  });

  it('leaves saved=false when no save_name is provided', async () => {
    // save() requires a live CDP client (getClient), so deploy must NOT call it
    // unless save_name is given. With no save_name, saved must be false.
    const { _deps } = makeDeps();
    const res = await deploy({ source: 'x', _deps });
    assert.equal(res.saved, false);
  });

  it('treats an empty save_name as "do not save"', async () => {
    const { _deps } = makeDeps();
    const res = await deploy({ source: 'x', save_name: '   ', _deps });
    assert.equal(res.saved, false);
  });

  it('requires a source', async () => {
    const { _deps } = makeDeps();
    await assert.rejects(() => deploy({ _deps }), /source is required/);
  });
});

describe('getMarketStatus() — market_status', () => {
  // getMarketStatus calls evaluate twice: first to read the current chart symbol,
  // then to read session info. This queue helper returns responses in FIFO order.
  function evalQueue(...responses) {
    let i = 0;
    return async () => responses[i++];
  }

  it('returns open for a regular subsession', async () => {
    const evaluate = evalQueue(
      'AAPL',
      { symbol: 'AAPL', exchange: 'NASDAQ', session: '0930-1600', subsession_id: 'regular', timezone: 'America/New_York' },
    );
    const res = await getMarketStatus({ symbol: 'AAPL', _deps: { evaluate } });
    assert.equal(res.success, true);
    assert.equal(res.status, 'open');
    assert.equal(res.symbol, 'AAPL');
    assert.equal(res.exchange, 'NASDAQ');
    assert.equal(res.source, 'cdp');
  });

  it('returns pre_market / post_market from subsession id', async () => {
    const pre = await getMarketStatus({ symbol: 'A', _deps: { evaluate: evalQueue('A', { symbol: 'A', session: 'x', subsession_id: 'premarket' }) } });
    assert.equal(pre.status, 'pre_market');
    assert.equal(pre.source, 'cdp');
    const post = await getMarketStatus({ symbol: 'A', _deps: { evaluate: evalQueue('A', { symbol: 'A', session: 'x', subsession_id: 'postmarket' }) } });
    assert.equal(post.status, 'post_market');
    assert.equal(post.source, 'cdp');
  });

  it('treats 24x7 session as open', async () => {
    const res = await getMarketStatus({ symbol: 'BTCUSD', _deps: { evaluate: evalQueue('BTCUSD', { symbol: 'BTCUSD', session: '24x7', subsession_id: '' }) } });
    assert.equal(res.status, 'open');
    assert.equal(res.source, 'cdp');
  });

  it('includes is_tradable from the renderer payload', async () => {
    const res = await getMarketStatus({ symbol: 'AAPL', _deps: { evaluate: evalQueue(
      'AAPL',
      { symbol: 'AAPL', exchange: 'NASDAQ', session: '0930-1600', subsession_id: 'regular', timezone: 'America/New_York', is_tradable: true },
    ) } });
    assert.equal(res.success, true);
    assert.equal(res.is_tradable, true);
  });

  it('returns is_tradable: null when the renderer omits it', async () => {
    const res = await getMarketStatus({ symbol: 'X', _deps: { evaluate: evalQueue('X', { symbol: 'X', session: '0900-1700', subsession_id: 'regular' }) } });
    assert.equal(res.success, true);
    assert.equal(res.is_tradable, null);
  });

  it('falls back to error when session data is unavailable', async () => {
    const res = await getMarketStatus({ symbol: 'AAPL', _deps: { evaluate: evalQueue('AAPL', null) } });
    assert.equal(res.success, false);
    assert.equal(res.error, 'session data unavailable');
    assert.equal(res.source, 'cdp');
  });

  it('falls back to error on evaluate exception payload', async () => {
    const res = await getMarketStatus({ symbol: 'AAPL', _deps: { evaluate: evalQueue('AAPL', { __error: 'boom' }) } });
    assert.equal(res.success, false);
    assert.equal(res.error, 'session data unavailable');
    assert.equal(res.source, 'cdp');
  });
});

describe('symbolInfo() — symbol_info', () => {
  // symbolInfo reads the current chart symbol, then reads symbolExt() metadata.
  function evalQueue(...responses) {
    let i = 0;
    return async () => responses[i++];
  }

  it('returns metadata tagged with source: cdp', async () => {
    const evaluate = evalQueue(
      'AAPL', // current symbol (matches, so no setSymbol)
      { symbol: 'AAPL', full_name: 'NASDAQ:AAPL', exchange: 'NASDAQ', description: 'Apple Inc.', type: 'stock', pro_name: 'NASDAQ:AAPL', typespecs: [], resolution: 'D', chart_type: 1 },
    );
    const res = await symbolInfo({ symbol: 'AAPL', _deps: { evaluate } });
    assert.equal(res.success, true);
    assert.equal(res.symbol, 'AAPL');
    assert.equal(res.exchange, 'NASDAQ');
    assert.equal(res.source, 'cdp');
  });

  it('requires a symbol', async () => {
    await assert.rejects(() => symbolInfo({ _deps: { evaluate: async () => ({}) } }), /symbol is required/);
  });
});

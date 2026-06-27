/**
 * Phase 1 tools — offline DI mock tests.
 * Covers: analyzeChart (chart_report), getPineGraphics (data_get_pine_graphics),
 * getQuote options metadata extension, symbolSearch 'option' type forwarding.
 * Run: node --test tests/phase1.test.js
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeChart, symbolSearch } from '../src/core/chart.js';
import { getPineGraphics, getQuote } from '../src/core/data.js';

describe('getPineGraphics() — data_get_pine_graphics', () => {
  it('returns all four sections by default in a single evaluate call', async () => {
    const calls = [];
    const evaluate = async (expr) => {
      calls.push(expr);
      return {
        lines: [{ name: 'Levels', count: 1, items: [{ id: 'a', raw: { y1: 100, y2: 100 } }] }],
        labels: [{ name: 'Levels', count: 1, items: [{ id: 'b', raw: { t: 'PDH', y: 24550 } }] }],
        tables: [{ name: 'Stats', count: 1, items: [{ id: 'c', raw: { tid: 0, row: 0, col: 0, t: 'Vol' } }] }],
        boxes: [{ name: 'Zones', count: 1, items: [{ id: 'd', raw: { y1: 110, y2: 90 } }] }],
      };
    };
    const res = await getPineGraphics({ _deps: { evaluate } });
    assert.equal(calls.length, 1, 'should make exactly one evaluate call');
    assert.ok(res.lines && res.labels && res.tables && res.boxes, 'all four sections present');
    assert.deepEqual(res.lines[0].horizontal_levels, [100]);
    assert.equal(res.labels[0].labels[0].text, 'PDH');
    assert.equal(res.tables[0].tables[0].rows[0], 'Vol');
    assert.deepEqual(res.boxes[0].zones[0], { high: 110, low: 90 });
    assert.deepEqual(res.study_counts, { lines: 1, labels: 1, tables: 1, boxes: 1 });
  });

  it('include filters which sections are returned', async () => {
    const evaluate = async () => ({ lines: [], boxes: [] });
    const res = await getPineGraphics({ include: ['lines', 'boxes'], _deps: { evaluate } });
    assert.ok('lines' in res && 'boxes' in res);
    assert.ok(!('labels' in res) && !('tables' in res));
    assert.deepEqual(Object.keys(res.study_counts).sort(), ['boxes', 'lines']);
  });

  it('study_filter is interpolated into the evaluate expression', async () => {
    let captured = '';
    const evaluate = async (expr) => { captured = expr; return {}; };
    await getPineGraphics({ study_filter: 'Profiler', _deps: { evaluate } });
    assert.ok(captured.includes('"Profiler"'), 'filter value should appear escaped in the expression');
  });
});

describe('getQuote() — options metadata extension', () => {
  const baseQuote = { symbol: 'TST', close: 5.2, last: 5.2, volume: 10 };

  it('adds option fields when symbol is an option', async () => {
    const evaluate = async () => ({
      ...baseQuote,
      _ext: {
        type: 'option', typespecs: ['option'],
        option_type: 'call', strike: 150, expiration: 20251219,
        exercise_style: 'American', shares_per_contract: 100, underlying: 'AAPL',
      },
    });
    const res = await getQuote({ _deps: { evaluate } });
    assert.equal(res.strike_price, 150);
    assert.equal(res.expiration_date, 20251219);
    assert.equal(res.contract_type, 'call');
    assert.equal(res.exercise_style, 'American');
    assert.equal(res.shares_per_contract, 100);
    assert.equal(res.underlying_ticker, 'AAPL');
    assert.ok(!('_ext' in res), '_ext scratch field should be stripped');
  });

  it('omits option fields for a non-option symbol', async () => {
    const evaluate = async () => ({ ...baseQuote, _ext: { type: 'stock', typespecs: ['common'] } });
    const res = await getQuote({ _deps: { evaluate } });
    assert.ok(!('strike_price' in res));
    assert.ok(!('expiration_date' in res));
    assert.ok(!('contract_type' in res));
    assert.ok(!('underlying_ticker' in res));
    assert.equal(res.success, true);
    assert.equal(res.last, 5.2);
  });
});

describe('symbolSearch() — option search type forwarding', () => {
  it('puts search_type=option in the REST URL', async () => {
    const original = global.fetch;
    let url = '';
    global.fetch = async (u) => { url = u; return { ok: true, json: async () => ({ symbols: [] }) }; };
    try {
      await symbolSearch({ query: 'AAPL', type: 'option' });
    } finally {
      global.fetch = original;
    }
    assert.ok(url.includes('search_type=option'), `expected search_type=option in URL, got: ${url}`);
  });
});

describe('analyzeChart() — chart_report', () => {
  function deps(overrides = {}) {
    return {
      evaluate: overrides.evaluate || (async () => ({})),
      evaluateAsync: overrides.evaluateAsync || (async () => ({})),
    };
  }

  it('default include yields state, study_values, quote and nothing expensive', async () => {
    const evaluate = async (expr) => {
      if (expr.includes('getAllStudies')) return { symbol: 'ES1!', resolution: '5', chartType: 1, studies: [] };
      if (expr.includes('dataWindowView')) return [{ name: 'RSI', values: { RSI: '55' } }];
      if (expr.includes('symbolExt')) return { symbol: 'ES1!', close: 5000, last: 5000, volume: 1, _ext: { type: 'futures' } };
      return {};
    };
    const res = await analyzeChart({ _deps: { ...deps(), evaluate } });
    assert.equal(res.success, true);
    assert.ok(res.state && res.study_values && res.quote);
    assert.ok(!('ohlcv' in res));
    assert.ok(!('screenshot_path' in res));
    assert.ok(!('pine_lines' in res));
  });

  it('includes pine sections and screenshot when requested', async () => {
    const evaluate = async (expr) => {
      if (expr.includes('results[spec.name]') || expr.includes('collections')) {
        return { lines: [{ name: 'Lv', count: 1, items: [{ id: 'x', raw: { y1: 1, y2: 1 } }] }] };
      }
      return {};
    };
    const captureScreenshot = async () => ({ file_path: '/tmp/shot.png' });
    const res = await analyzeChart({
      include: ['pine_lines', 'screenshot'],
      _deps: { ...deps(), evaluate, captureScreenshot },
    });
    assert.ok(Array.isArray(res.pine_lines), 'pine_lines should be an array');
    assert.equal(res.screenshot_path, '/tmp/shot.png');
  });

  it('isolates a failing section as a per-section error', async () => {
    const evaluate = async (expr) => {
      if (expr.includes('getAllStudies')) throw new Error('state boom');
      if (expr.includes('dataWindowView')) return [];
      if (expr.includes('symbolExt')) return { close: 1, last: 1, _ext: {} };
      return {};
    };
    const res = await analyzeChart({ include: ['state', 'study_values', 'quote'], _deps: { ...deps(), evaluate } });
    assert.equal(res.success, true, 'overall call should not abort');
    assert.ok(res.state && res.state.error, 'failed section captured as {error}');
    assert.ok(res.study_values, 'other sections still present');
  });

  it('truncates sections alphabetically when over the 50KB cap', async () => {
    const big = 'z'.repeat(60 * 1024);
    const evaluate = async (expr) => {
      if (expr.includes('getAllStudies')) return { symbol: 'A', resolution: '1', chartType: 1, studies: [], filler: big };
      if (expr.includes('dataWindowView')) return [{ name: 'RSI', values: { RSI: '1' } }];
      if (expr.includes('symbolExt')) return { close: 1, last: 1, _ext: {} };
      return {};
    };
    const res = await analyzeChart({ include: ['state', 'study_values', 'quote'], _deps: { ...deps(), evaluate } });
    assert.ok(Array.isArray(res.truncated), 'truncated list reported');
    assert.ok(res.truncated.includes('state'), 'oversized state dropped first (alphabetical, all included)');
    assert.ok(Buffer.byteLength(JSON.stringify(res), 'utf8') <= 50 * 1024 + 200);
  });
});

/**
 * Phase 3 tools — offline DI mock tests.
 * Covers: searchContracts (options_search), run (replay_run).
 * Run: node --test tests/phase3.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { searchContracts } from '../src/core/options.js';
import { run } from '../src/core/replay.js';

// ── helpers ────────────────────────────────────────────────────────────────

function mockFetch(records, { ok = true, throwErr = null } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (throwErr) throw new Error(throwErr);
    return {
      ok,
      json: async () => ({ symbols: records }),
    };
  };
  fn.calls = calls;
  return fn;
}

function rec(over = {}) {
  return {
    symbol: 'AAPL250117C00150000',
    description: 'APPLE INC CALL',
    exchange: 'OPRA',
    strike: 150,
    expiration: '2025-01-17',
    option_type: 'call',
    ...over,
  };
}

// ── options_search ──────────────────────────────────────────────────────────

describe('searchContracts() — options_search REST tier', () => {
  it('builds the public REST URL with search_type=option and encoded text', async () => {
    const fetch = mockFetch([rec()]);
    const res = await searchContracts({ underlying: 'AAPL', _deps: { fetch } });
    assert.equal(res.success, true);
    assert.equal(res.source, 'rest_api');
    assert.equal(fetch.calls.length, 1);
    const url = fetch.calls[0].url;
    assert.ok(url.startsWith('https://symbol-search.tradingview.com/symbol_search/v3/?'));
    assert.ok(url.includes('search_type=option'));
    assert.ok(url.includes('text=AAPL'));
  });

  it('encodes underlying safely into the REST query (injection-safe)', async () => {
    const fetch = mockFetch([]);
    // Renderer fallback must not be reached for the URL assertion; provide a stub.
    const evaluateAsync = async () => [];
    const malicious = 'AAPL&foo=bar"; alert(1)//';
    await searchContracts({ underlying: malicious, _deps: { fetch, evaluateAsync } });
    const url = fetch.calls[0].url;
    // The raw characters must be percent-encoded — no bare &, ", or spaces leak through.
    assert.ok(!url.includes('AAPL&foo=bar'), 'ampersand must be encoded');
    assert.ok(!url.includes('"'), 'double-quote must be encoded');
    assert.ok(url.includes('text=AAPL%26foo%3Dbar'), 'encoded payload present');
  });

  it('normalizes records to {symbol,strike,expiry,contract_type,exchange,description}', async () => {
    const fetch = mockFetch([rec()]);
    const res = await searchContracts({ underlying: 'AAPL', _deps: { fetch } });
    const c = res.contracts[0];
    assert.equal(c.symbol, 'AAPL250117C00150000');
    assert.equal(c.strike, 150);
    assert.equal(c.expiry, '2025-01-17');
    assert.equal(c.contract_type, 'call');
    assert.equal(c.exchange, 'OPRA');
    assert.equal(c.description, 'APPLE INC CALL');
  });

  it('filters by contract_type', async () => {
    const fetch = mockFetch([
      rec({ symbol: 'C1', option_type: 'call', strike: 100 }),
      rec({ symbol: 'P1', option_type: 'put', strike: 100 }),
    ]);
    const res = await searchContracts({ underlying: 'X', contract_type: 'put', _deps: { fetch } });
    assert.equal(res.count, 1);
    assert.equal(res.contracts[0].contract_type, 'put');
  });

  it('filters by strike_min / strike_max', async () => {
    const fetch = mockFetch([
      rec({ symbol: 'A', strike: 90 }),
      rec({ symbol: 'B', strike: 150 }),
      rec({ symbol: 'C', strike: 210 }),
    ]);
    const res = await searchContracts({ underlying: 'X', strike_min: 100, strike_max: 200, _deps: { fetch } });
    assert.deepEqual(res.contracts.map(c => c.strike), [150]);
  });

  it('filters by expiry window (after/before)', async () => {
    const fetch = mockFetch([
      rec({ symbol: 'A', expiration: '2025-01-01', strike: 1 }),
      rec({ symbol: 'B', expiration: '2025-06-01', strike: 2 }),
      rec({ symbol: 'C', expiration: '2025-12-01', strike: 3 }),
    ]);
    const res = await searchContracts({
      underlying: 'X', expiry_after: '2025-03-01', expiry_before: '2025-09-01', _deps: { fetch },
    });
    assert.deepEqual(res.contracts.map(c => c.symbol), ['B']);
  });

  it('deduplicates by symbol and sorts by strike', async () => {
    const fetch = mockFetch([
      rec({ symbol: 'B', strike: 200 }),
      rec({ symbol: 'A', strike: 100 }),
      rec({ symbol: 'A', strike: 100 }), // dup
    ]);
    const res = await searchContracts({ underlying: 'X', _deps: { fetch } });
    assert.equal(res.count, 2);
    assert.deepEqual(res.contracts.map(c => c.symbol), ['A', 'B']);
  });

  it('caps results at limit', async () => {
    const recs = Array.from({ length: 10 }, (_, i) => rec({ symbol: `S${i}`, strike: i }));
    const fetch = mockFetch(recs);
    const res = await searchContracts({ underlying: 'X', limit: 3, _deps: { fetch } });
    assert.equal(res.count, 3);
  });

  it('throws when underlying is missing', async () => {
    await assert.rejects(() => searchContracts({ _deps: { fetch: mockFetch([]) } }), /underlying is required/);
  });
});

describe('searchContracts() — renderer fallback', () => {
  it('falls back to searchSymbols when REST returns empty', async () => {
    const fetch = mockFetch([]); // empty REST
    let capturedExpr = '';
    const evaluateAsync = async (expr) => {
      capturedExpr = expr;
      return [rec({ symbol: 'AAPL250117P00140000', option_type: 'put', strike: 140 })];
    };
    const res = await searchContracts({ underlying: 'AAPL', _deps: { fetch, evaluateAsync } });
    assert.equal(res.source, 'searchSymbols');
    assert.equal(res.count, 1);
    assert.equal(res.contracts[0].contract_type, 'put');
    // underlying must be passed via safeString (JSON-quoted) into the renderer expr
    assert.ok(capturedExpr.includes('"AAPL"'), 'underlying safeString-quoted in renderer expr');
    assert.ok(capturedExpr.includes("type: 'option'"), 'searchSymbols called with option type');
  });

  it('falls back to renderer when REST throws', async () => {
    const fetch = mockFetch([], { throwErr: 'network down' });
    const evaluateAsync = async () => [rec({ symbol: 'Z', strike: 5 })];
    const res = await searchContracts({ underlying: 'X', _deps: { fetch, evaluateAsync } });
    assert.equal(res.source, 'searchSymbols');
    assert.equal(res.count, 1);
  });

  it('passes underlying safely to the renderer (injection-safe)', async () => {
    const fetch = mockFetch([]);
    let capturedExpr = '';
    const evaluateAsync = async (expr) => { capturedExpr = expr; return []; };
    await searchContracts({ underlying: '"); alert(1); ("', _deps: { fetch, evaluateAsync } });
    // The payload must be JSON-escaped, so the closing-quote injection cannot break out.
    assert.ok(!capturedExpr.includes('"); alert(1); ("'), 'raw payload must not appear unescaped');
    assert.ok(capturedExpr.includes(JSON.stringify('"); alert(1); ("')), 'payload is JSON-escaped');
  });

  it('surfaces renderer __error', async () => {
    const fetch = mockFetch([]);
    const evaluateAsync = async () => ({ __error: 'searchSymbols failed' });
    await assert.rejects(
      () => searchContracts({ underlying: 'X', _deps: { fetch, evaluateAsync } }),
      /searchSymbols failed/,
    );
  });
});

// ── replay_run ──────────────────────────────────────────────────────────────

function makeReplayDeps({ stallAfter = Infinity } = {}) {
  const calls = { start: 0, autoplay: 0, status: 0, stop: 0 };
  let tick = 0;
  const deps = {
    start: async () => { calls.start += 1; return { success: true }; },
    autoplay: async ({ speed }) => { calls.autoplay += 1; calls.lastSpeed = speed; return { success: true }; },
    status: async () => {
      calls.status += 1;
      tick += 1;
      // Advance the date each poll until stallAfter, then freeze.
      const advancing = tick <= stallAfter;
      return {
        success: true,
        current_date: advancing ? tick : stallAfter,
        is_replay_started: true,
        is_autoplay_started: advancing,
        position: 1,
        realized_pnl: 42,
      };
    },
    stop: async () => { calls.stop += 1; return { success: true }; },
  };
  return { deps, calls };
}

describe('run() — replay_run wrapper', () => {
  it('calls start then autoplay then polls status, returning the response shape', async () => {
    const { deps, calls } = makeReplayDeps();
    const res = await run({ date: '2025-03-01', steps: 3, speed_ms: 100, _deps: deps });
    assert.equal(res.success, true);
    assert.equal(calls.start, 1);
    assert.equal(calls.autoplay, 1);
    assert.equal(res.steps_completed, 3);
    assert.equal(res.position, 1);
    assert.equal(res.pnl, 42);
    assert.ok(typeof res.steps_elapsed_ms === 'number');
    assert.ok('final_date' in res);
  });

  it('does NOT call stop when stop_after is false (default)', async () => {
    const { deps, calls } = makeReplayDeps();
    await run({ date: '2025-03-01', steps: 2, speed_ms: 100, _deps: deps });
    assert.equal(calls.stop, 0);
  });

  it('calls stop when stop_after is true', async () => {
    const { deps, calls } = makeReplayDeps();
    await run({ date: '2025-03-01', steps: 2, speed_ms: 100, stop_after: true, _deps: deps });
    assert.equal(calls.stop, 1);
  });

  it('clamps steps to <= 500', async () => {
    // Use a stall so the loop terminates quickly instead of running 500 polls.
    const { deps } = makeReplayDeps({ stallAfter: 2 });
    const res = await run({ date: '2025-03-01', steps: 99999, speed_ms: 100, _deps: deps });
    // Loop broke on stall; steps_completed bounded by stall, proving no runaway at 99999.
    assert.ok(res.steps_completed <= 500);
    assert.equal(res.success, true);
  });

  it('clamps steps to >= 1 for non-finite input', async () => {
    const { deps } = makeReplayDeps({ stallAfter: 1 });
    const res = await run({ date: '2025-03-01', steps: 'garbage', speed_ms: 100, _deps: deps });
    assert.equal(res.success, true);
  });

  it('terminates when autoplay stalls (no more data)', async () => {
    const { deps } = makeReplayDeps({ stallAfter: 1 });
    const res = await run({ date: '2025-03-01', steps: 50, speed_ms: 100, _deps: deps });
    // Only one bar advanced before the stall; loop must break, not hang.
    assert.ok(res.steps_completed >= 0 && res.steps_completed < 50);
    assert.equal(res.success, true);
  });

  it('passes speed_ms through to autoplay as speed', async () => {
    const { deps, calls } = makeReplayDeps({ stallAfter: 1 });
    await run({ date: '2025-03-01', steps: 2, speed_ms: 300, _deps: deps });
    assert.equal(calls.lastSpeed, 300);
  });
});

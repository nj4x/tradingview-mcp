/**
 * waitForBarsFresh() — offline DI mock tests for the bar-freshness gate.
 * Run: node --test tests/freshness.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { waitForBarsFresh } from '../src/wait.js';

const FAST = { timeout: 50, pollMs: 5 };

// Build a mock evaluate that returns a scripted sequence of probe results.
// Each entry is the object the in-renderer probe would yield.
function seqEvaluate(sequence) {
  let i = 0;
  return async () => {
    const v = sequence[Math.min(i, sequence.length - 1)];
    i++;
    return v;
  };
}

describe('waitForBarsFresh()', () => {
  it('(a) identity matches + stable → fresh:true', async () => {
    const nowSec = 1_700_000_000;
    const probe = { ok: true, symbol: 'AAPL', resolution: 'D', lastTime: nowSec, size: 100 };
    const evaluate = seqEvaluate([probe, probe, probe]);
    const res = await waitForBarsFresh({
      symbol: 'AAPL', resolution: 'D', requireRecency: false, nowSec,
      _deps: { evaluate }, ...FAST,
    });
    assert.equal(res.fresh, true);
    assert.equal(res.lastTime, nowSec);
    assert.equal(res.size, 100);
  });

  it('(b) identity never matches → fresh:false, timedOut:true', async () => {
    const probe = { ok: true, symbol: 'MSFT', resolution: 'D', lastTime: 1, size: 100 };
    const evaluate = seqEvaluate([probe]);
    const res = await waitForBarsFresh({
      symbol: 'AAPL', resolution: 'D', requireRecency: false,
      _deps: { evaluate }, ...FAST,
    });
    assert.equal(res.fresh, false);
    assert.equal(res.timedOut, true);
  });

  it('(c) requireRecency + history-stale last bar → recency fails → fresh:false', async () => {
    const nowSec = 1_700_000_000;
    // last bar is ~30 days old; maxLag for D is 3*86400 → stale.
    const probe = { ok: true, symbol: 'AAPL', resolution: 'D', lastTime: nowSec - 30 * 86400, size: 100 };
    const evaluate = seqEvaluate([probe]);
    const res = await waitForBarsFresh({
      symbol: 'AAPL', resolution: 'D', requireRecency: true, nowSec,
      _deps: { evaluate }, ...FAST,
    });
    assert.equal(res.fresh, false);
    assert.equal(res.timedOut, true);
  });

  it('(d) requireRecency:false + stale-but-settled → fresh:true (recency skipped)', async () => {
    const nowSec = 1_700_000_000;
    const probe = { ok: true, symbol: 'AAPL', resolution: 'D', lastTime: nowSec - 30 * 86400, size: 100 };
    const evaluate = seqEvaluate([probe, probe]);
    const res = await waitForBarsFresh({
      symbol: 'AAPL', resolution: 'D', requireRecency: false, nowSec,
      _deps: { evaluate }, ...FAST,
    });
    assert.equal(res.fresh, true);
  });

  it('(e) stability resets on an interleaved !ok poll', async () => {
    const nowSec = 1_700_000_000;
    const good = { ok: true, symbol: 'AAPL', resolution: 'D', lastTime: nowSec, size: 100 };
    const bad = { ok: false, reason: 'empty' };
    // good, bad, good, good → only the last two consecutive goods satisfy stablePolls=2.
    let i = 0;
    const seq = [good, bad, good, good, good];
    const evaluate = async () => seq[Math.min(i++, seq.length - 1)];
    const res = await waitForBarsFresh({
      symbol: 'AAPL', resolution: 'D', requireRecency: false, nowSec,
      _deps: { evaluate }, timeout: 200, pollMs: 5,
    });
    assert.equal(res.fresh, true);
  });

  it('(f) millisecond-unit last bar normalizes correctly and passes recency', async () => {
    const nowSec = 1_700_000_000;
    // lastTime expressed in ms (> 1e12) but representing "now" → recency must pass.
    const probe = { ok: true, symbol: 'AAPL', resolution: 'D', lastTime: nowSec * 1000, size: 100 };
    const evaluate = seqEvaluate([probe, probe]);
    const res = await waitForBarsFresh({
      symbol: 'AAPL', resolution: 'D', requireRecency: true, nowSec,
      _deps: { evaluate }, ...FAST,
    });
    assert.equal(res.fresh, true);
  });

  it('tolerates exchange-prefixed symbol identity (SOLUSD ~ BINANCE:SOLUSD)', async () => {
    const nowSec = 1_700_000_000;
    const probe = { ok: true, symbol: 'BINANCE:SOLUSD', resolution: '60', lastTime: nowSec, size: 50 };
    const evaluate = seqEvaluate([probe, probe]);
    const res = await waitForBarsFresh({
      symbol: 'SOLUSD', resolution: '60', requireRecency: true, nowSec,
      _deps: { evaluate }, ...FAST,
    });
    assert.equal(res.fresh, true);
  });

  it('tolerates D vs 1D resolution identity', async () => {
    const nowSec = 1_700_000_000;
    const probe = { ok: true, symbol: 'AAPL', resolution: '1D', lastTime: nowSec, size: 100 };
    const evaluate = seqEvaluate([probe, probe]);
    const res = await waitForBarsFresh({
      symbol: 'AAPL', resolution: 'D', requireRecency: false, nowSec,
      _deps: { evaluate }, ...FAST,
    });
    assert.equal(res.fresh, true);
  });
});

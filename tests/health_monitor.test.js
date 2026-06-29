import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startHealthMonitor } from '../src/core/health.js';

describe('startHealthMonitor', () => {
  it('calls cdpReachable on each tick and does nothing when CDP is up', async () => {
    let checkCalls = 0;
    let ensureCalls = 0;
    const _deps = {
      cdpReachable: async () => { checkCalls++; return true; },
      ensureTradingViewRunning: async () => { ensureCalls++; return { launched: false }; },
    };
    const timer = startHealthMonitor({ intervalMs: 30, _deps });
    await new Promise(r => setTimeout(r, 80));
    clearInterval(timer);
    assert.ok(checkCalls >= 2, `expected ≥2 checks, got ${checkCalls}`);
    assert.equal(ensureCalls, 0, 'should not relaunch when CDP is reachable');
  });

  it('calls ensureTradingViewRunning when CDP is down', async () => {
    let ensureCalls = 0;
    const _deps = {
      cdpReachable: async () => false,
      ensureTradingViewRunning: async () => { ensureCalls++; return { launched: true }; },
    };
    const timer = startHealthMonitor({ intervalMs: 30, _deps });
    await new Promise(r => setTimeout(r, 50));
    clearInterval(timer);
    assert.ok(ensureCalls >= 1, `expected ≥1 relaunch, got ${ensureCalls}`);
  });

  it('re-entrancy guard: skips concurrent ticks while a relaunch is in progress', async () => {
    let ensureCalls = 0;
    let resolveRelaunch;
    const _deps = {
      cdpReachable: async () => false,
      ensureTradingViewRunning: () => {
        ensureCalls++;
        return new Promise(r => { resolveRelaunch = () => r({ launched: true }); });
      },
    };
    // Interval is 20ms; relaunch never resolves during the test window → guard must block further attempts
    const timer = startHealthMonitor({ intervalMs: 20, _deps });
    await new Promise(r => setTimeout(r, 100)); // 5+ ticks fire while first relaunch is pending
    clearInterval(timer);
    if (resolveRelaunch) resolveRelaunch(); // clean up the pending promise
    assert.equal(ensureCalls, 1, 'only one relaunch should be in flight at a time');
  });

  it('timer is unref\'d so it does not prevent process exit', () => {
    const _deps = {
      cdpReachable: async () => true,
      ensureTradingViewRunning: async () => ({ launched: false }),
    };
    const timer = startHealthMonitor({ intervalMs: 60_000, _deps });
    // Node timers that are ref'd prevent process exit; unref'd do not.
    // The internal _idleNext is null for unref'd timers in some versions,
    // but the public API is timer.hasRef() (Node 16+).
    assert.equal(timer.hasRef(), false, 'timer should be unref\'d');
    clearInterval(timer);
  });
});

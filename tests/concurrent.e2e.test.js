/**
 * CdpPool live concurrency tests.
 *
 * Exercises the real CdpPool+cdpDiscovery against a live TradingView Desktop on port 9222.
 * ALL tests skip gracefully when TV is absent — never calls process.exit().
 *
 * C-1  Two concurrent headless acquires land on distinct real tabs
 * C-2  Acquire blocks at capacity; unblocks synchronously after a tab is freed
 * C-3  Concurrent evaluations on distinct tabs route to their own connections
 * C-4  drain() closes only self-created tabs; adopted primary survives
 *
 * C-1/C-2/C-3 require race-safe tab creation: PUT /json/new OR window.open (serialized).
 * The Cmd+T fallback diffs target-list before/after and is NOT safe to call concurrently.
 * C-4 works with either path (sequential grow).
 *
 * Run: npm run test:concurrent   (requires live TradingView on --remote-debugging-port=9222)
 * TV_MCP_CDP_PORT must be set before the process starts (cdpDiscovery reads it at module load).
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as cdpDiscovery from '../src/core/cdpDiscovery.js';
import * as tabModule from '../src/core/tab.js';
import { CdpPool } from '../src/core/CdpPool.js';

const HOST = process.env.TV_MCP_CDP_HOST || 'localhost';
const PORT = Number(process.env.TV_MCP_CDP_PORT || 9222);

let hasTV = false;
let growSupported = false; // PUT /json/new OR window.open available (race-safe creates)
let baselineIds = new Set();

try {
  // Use listChartTargets() — same URL+type filter as the pool.
  const charts = await cdpDiscovery.listChartTargets();
  hasTV = charts.length > 0;

  if (hasTV) {
    const all = await fetch(`http://${HOST}:${PORT}/json/list`).then(r => r.json());
    baselineIds = new Set(all.map(t => t.id));

    // Probe via createNewTarget with a stub tabModule that blocks Cmd+T.
    // If PUT /json/new or window.open works, createNewTarget succeeds without touching
    // tabModule — so we never open the persistent getClient() WebSocket that would
    // keep the event loop alive and prevent clean test exit.
    const stubTabModule = {
      newTab: () => Promise.reject(new Error('Cmd+T intentionally blocked in probe')),
    };
    try {
      const { conn, createdTargetId } = await cdpDiscovery.createNewTarget({ tabModule: stubTabModule });
      await conn.dispose();
      await cdpDiscovery.closeTarget(createdTargetId);
      growSupported = true;
    } catch { /* tab creation not supported on this TV build */ }
  }
} catch { /* CDP unreachable */ }

describe('CdpPool concurrent e2e (requires live TradingView)', {
  skip: hasTV ? undefined : `TradingView not reachable on ${HOST}:${PORT}`,
}, () => {
  let pool;

  beforeEach(async () => {
    pool = new CdpPool({ discovery: cdpDiscovery, tabModule, maxTabs: 3 });
    await pool.ensurePrimary(); // adopt or create; places primary in _idle
  });

  afterEach(async () => {
    // Snapshot BEFORE drain — drain() calls _createdTargetIds.clear() at line 371.
    const created = new Set(pool._createdTargetIds);
    try { await pool.drain(10000); } catch { /* best-effort */ }

    if (created.size === 0) return;

    // Poll until all self-created ids vanish from the live target list.
    // DELETE /json/close returns ok before Electron completes tab teardown.
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const live = await cdpDiscovery.listChartTargets().catch(() => []);
      const liveIds = new Set(live.map(t => t.id));
      if ([...created].every(id => !liveIds.has(id))) break;
      await new Promise(r => setTimeout(r, 200));
    }
  });

  // ── C-1: concurrent PUT-based grows land on distinct real tabs ─────────

  it('C-1: two concurrent headless acquires produce distinct tab ids',
    { skip: growSupported ? undefined : 'tab creation (PUT /json/new or window.open) not supported on this TV build',
      timeout: 60000 },
    async () => {
      // Park the primary (idle after ensurePrimary) so both headless acquires hit
      // an empty _idle and must each call _growHeadless → createNewTarget.
      // PUT /json/new returns a unique id per call atomically → safe under concurrency.
      const vis = await pool.acquire('visible');
      let a, b;
      try {
        [a, b] = await Promise.all([
          pool.acquire('headless'),
          pool.acquire('headless'),
        ]);

        assert.notEqual(a.id, b.id, 'distinct physical tabs');
        assert.equal(a.selfCreated, true, 'a is a self-created worker');
        assert.equal(b.selfCreated, true, 'b is a self-created worker');
        assert.ok(pool._createdTargetIds.has(a.id), 'a tracked for cleanup');
        assert.ok(pool._createdTargetIds.has(b.id), 'b tracked for cleanup');
      } finally {
        if (a) pool.release(a);
        if (b) pool.release(b);
        pool.release(vis);
      }
    }
  );

  // ── C-2: queue-blocks at capacity; unblocks after release ─────────────

  it('C-2: acquire blocks at capacity; resolves after a tab is freed',
    { skip: growSupported ? undefined : 'tab creation (PUT /json/new or window.open) not supported on this TV build',
      timeout: 90000 },
    async () => {
      // Sequential awaits so _pendingCount is 0 before assertions (each _growHeadless
      // decrements _pendingCount in its finally block on resolution).
      const vis = await pool.acquire('visible');  // primary → _used
      const w1  = await pool.acquire('headless'); // grows worker-1 → _used
      const w2  = await pool.acquire('headless'); // grows worker-2 → _used

      assert.equal(pool.size, 3, 'pool at maxTabs capacity');
      assert.equal(pool._idle.length, 0, 'nothing idle');
      assert.equal(pool._pendingCount, 0, 'no in-flight creates');

      // 4th headless cannot grow (size === maxTabs) → parks as an untargeted waiter.
      let resolved = false;
      const pending = pool.acquire('headless').then(c => { resolved = true; return c; });

      await Promise.resolve(); await Promise.resolve();
      await new Promise(r => setTimeout(r, 20));
      assert.equal(resolved, false, 'waiter parked at capacity');
      assert.equal(pool._waiters.length, 1, 'one waiter queued');
      assert.ok(!w1.dead, 'w1 is alive before release');

      // Release a live worker → _serviceWaiters hands it to the parked waiter synchronously.
      pool.release(w1);
      const w3 = await pending;
      assert.equal(resolved, true, 'unblocked after release');
      assert.ok(w3 && !w3.dead, 'received a live connection');

      pool.release(vis);
      pool.release(w2);
      pool.release(w3);
    }
  );

  // ── C-3: concurrent evaluations route to their own connections ─────────

  it('C-3: concurrent evaluations on distinct tabs go to their own connections',
    { skip: growSupported ? undefined : 'tab creation (PUT /json/new or window.open) not supported on this TV build',
      timeout: 60000 },
    async () => {
      const vis = await pool.acquire('visible');
      let a, b;
      try {
        [a, b] = await Promise.all([
          pool.acquire('headless'),
          pool.acquire('headless'),
        ]);

        assert.notEqual(a.id, b.id, 'different CDP targets');
        assert.equal(a.selfCreated, true);
        assert.equal(b.selfCreated, true);

        // Sequential writes: concurrent writes across connections have undefined ordering;
        // sequential writes make the round-trip assertions deterministic.
        // The goal is proving each evaluate() routes to its own CdpConnection, not
        // tab-level isolation (separate V8 isolates already guarantee that).
        await a.evaluate('window.__tvMcpTestMarker = "A"');
        await b.evaluate('window.__tvMcpTestMarker = "B"');
        const mA = await a.evaluate('window.__tvMcpTestMarker');
        const mB = await b.evaluate('window.__tvMcpTestMarker');
        assert.equal(mA, 'A', 'tab A marker intact after B write');
        assert.equal(mB, 'B', 'tab B marker intact after A write');
      } finally {
        if (a) pool.release(a);
        if (b) pool.release(b);
        pool.release(vis);
      }
    }
  );

  // ── C-4: drain() closes only self-created tabs; adopted primary survives ─

  it('C-4: drain closes self-created tabs only; adopted primary survives',
    { skip: growSupported ? undefined : 'tab creation (PUT /json/new or window.open) not supported on this TV build',
      timeout: 45000 },
    async () => {
      const primaryId = pool._primary.id;

      // OPS-2 invariant: pool deliberately omits the primary from _createdTargetIds
      // even when ensurePrimary had to create it. Check the set, not conn.selfCreated
      // (which can be true for a pool-created primary).
      assert.ok(!pool._createdTargetIds.has(primaryId),
        'primary not in self-created set — drain must not close it');

      // Park primary to force a real worker creation via headless.
      const vis = await pool.acquire('visible');
      const w   = await pool.acquire('headless');
      const workerId = w.id;
      assert.equal(w.selfCreated, true, 'worker is self-created');
      assert.ok(pool._createdTargetIds.has(workerId), 'worker tracked for cleanup');

      pool.release(w);
      pool.release(vis);

      // Snapshot before drain clears the set.
      const createdBefore = new Set(pool._createdTargetIds);
      assert.ok(createdBefore.has(workerId));

      await pool.drain(8000);

      // Primary must survive in the live target list (drain disposes the CDP connection
      // but never calls closeTarget on the primary — check the live target, not conn.dead).
      const afterTargets = await cdpDiscovery.listChartTargets();
      const afterIds = new Set(afterTargets.map(t => t.id));
      assert.ok(afterIds.has(primaryId), 'adopted primary tab still alive after drain');

      // Worker must eventually disappear (DELETE /json/close is async on Electron).
      let workerGone = false;
      const deadline = Date.now() + 4000;
      while (Date.now() < deadline) {
        const live = await cdpDiscovery.listChartTargets();
        if (!live.find(t => t.id === workerId)) { workerGone = true; break; }
        await new Promise(r => setTimeout(r, 150));
      }
      assert.ok(workerGone, `worker ${workerId} should be closed by drain`);
    }
  );
});

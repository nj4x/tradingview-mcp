/**
 * CdpPool unit tests (PHASE 1 Wave 5). Fully offline — no live chart.
 *
 * Injects a FAKE discovery (listChartTargets/attach/createNewTarget/closeTarget) and
 * FAKE connections (EventEmitter with stubbed evaluate/dispose) into CdpPool, so every
 * concurrency invariant (I-1..I-7, OPS-2, ARCH-1, drain) is exercised without CDP.
 *
 * Run: node --test tests/pool.test.js
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CdpPool } from '../src/core/CdpPool.js';
import { TvError } from '../src/core/TvError.js';

// --- fakes -----------------------------------------------------------------

let _idSeq = 0;

class FakeConn extends EventEmitter {
  constructor({ role = 'worker', id } = {}) {
    super();
    this.id = id || `tab-${++_idSeq}`;
    this.target = { id: this.id, url: 'https://www.tradingview.com/chart/abc', title: 'chart' };
    this.role = role;
    this.dead = false;
    this.route = null;
    this.disposed = false;
  }
  evaluate() { return Promise.resolve(1); }
  evaluateAsync() { return Promise.resolve(1); }
  async dispose() { this.disposed = true; this.dead = true; }
  // simulate a CDP-level drop
  kill() { this.dead = true; this.emit('disconnect', 'test-kill'); }
}

/**
 * Build a fake discovery module + a control surface for the test.
 * - existingTargets: ids the pool should "adopt" as primaries on listChartTargets().
 * - createBehavior: () => FakeConn | throws — what createNewTarget returns each call.
 */
function makeDiscovery(opts = {}) {
  const state = {
    created: [],        // conns handed out by createNewTarget
    closed: [],         // ids passed to closeTarget
    listCalls: 0,
    createCalls: 0,
  };
  const existing = (opts.existingTargets || []).map(id => ({ id, url: 'https://www.tradingview.com/chart/x', title: 't' }));
  const discovery = {
    async listChartTargets() {
      state.listCalls += 1;
      if (opts.listThrows && state.listCalls <= opts.listThrows) {
        throw new TvError('CDP_DOWN', 'cdp down (test)');
      }
      return existing.slice();
    },
    async attach(target, { role = 'worker' } = {}) {
      return new FakeConn({ role, id: target.id });
    },
    async createNewTarget() {
      state.createCalls += 1;
      if (opts.createThrows && state.createCalls <= opts.createThrows) {
        throw new TvError('CDP_DOWN', 'create failed (test)');
      }
      const conn = (opts.createBehavior ? opts.createBehavior(state) : new FakeConn());
      const createdTargetId = conn.id;
      state.created.push(conn);
      return { conn, createdTargetId };
    },
    async closeTarget(id) { state.closed.push(id); return true; },
  };
  return { discovery, state };
}

function newPool(discOpts = {}, poolOpts = {}) {
  const { discovery, state } = makeDiscovery(discOpts);
  const pool = new CdpPool({ discovery, tabModule: { async newTab() {} }, ...poolOpts });
  return { pool, state };
}

// --- tests -----------------------------------------------------------------

describe('CdpPool', () => {
  beforeEach(() => { _idSeq = 0; });

  it('ensurePrimary adopts an existing target (no create)', async () => {
    const { pool, state } = newPool({ existingTargets: ['user-tab'] });
    const primary = await pool.ensurePrimary();
    assert.equal(primary.id, 'user-tab');
    assert.equal(primary.role, 'primary');
    assert.equal(state.createCalls, 0, 'should adopt, not create');
    assert.ok(!pool._createdTargetIds.has('user-tab'), 'adopted primary is not self-created');
  });

  it('ensurePrimary creates a tab when none exist (not tracked as self-created)', async () => {
    const { pool, state } = newPool({ existingTargets: [] });
    const primary = await pool.ensurePrimary();
    assert.equal(state.createCalls, 1);
    assert.ok(!pool._createdTargetIds.has(primary.id),
      'primary created from zero tabs must NOT be auto-closed on drain (OPS-2)');
  });

  it('M-2: concurrent ensurePrimary share one init (create called once)', async () => {
    const { pool, state } = newPool({ existingTargets: [] });
    const [a, b] = await Promise.all([pool.ensurePrimary(), pool.ensurePrimary()]);
    assert.equal(a, b);
    assert.equal(state.createCalls, 1, '_primaryInitPromise guard → one create');
  });

  it('ARCH-1: route placement visible→primary, headless→worker, {tabId}→exact', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] }, { maxTabs: 3 });
    await pool.ensurePrimary();
    const vis = await pool.acquire('visible');
    assert.equal(vis.id, 'primary');

    // primary is leased → headless must GROW a non-primary worker, not block on primary.
    const w = await pool.acquire('headless');
    assert.notEqual(w.id, 'primary', 'headless grows/uses a non-primary worker');
    assert.equal(w.role, 'worker');
    pool.release(vis);

    // pin the worker by exact id
    pool.release(w);
    const pinned = await pool.acquire({ tabId: w.id });
    assert.equal(pinned.id, w.id);
    pool.release(pinned);
  });

  it('I-5: acquire({tabId}) for an unknown tab fast-fails TARGET_GONE', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] });
    await pool.ensurePrimary();
    await assert.rejects(
      () => pool.acquire({ tabId: 'ghost' }),
      (e) => e instanceof TvError && e.code === 'TARGET_GONE',
    );
  });

  it('I-1: never exceeds maxTabs under a concurrent acquire burst', async () => {
    const { pool, state } = newPool({ existingTargets: ['primary'] }, { maxTabs: 3 });
    await pool.ensurePrimary();
    // Fire 6 concurrent headless acquires; only 2 worker slots exist beyond the primary.
    const acquired = [];
    const pending = [];
    for (let i = 0; i < 6; i++) {
      pending.push(pool.acquire('headless').then(c => acquired.push(c)));
    }
    // Let the 3 grabbable tabs (primary + 2 workers) get taken.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    await new Promise(r => setTimeout(r, 10));
    assert.ok(pool.size <= 3, `size ${pool.size} must not exceed maxTabs 3`);
    assert.ok(state.createCalls <= 2, `at most 2 worker creates, got ${state.createCalls}`);
    // Release everything taken so the queued waiters drain and the test ends cleanly.
    for (const c of acquired.slice()) pool.release(c);
    await new Promise(r => setTimeout(r, 10));
    for (const c of acquired.slice()) pool.release(c);
  });

  it('I-2: a tab dies while a waiter is queued → replacement grown, waiter resolves', async () => {
    const { pool, state } = newPool({ existingTargets: ['primary'] }, { maxTabs: 2 });
    await pool.ensurePrimary();
    const a = await pool.acquire('headless'); // takes primary (only idle)
    const b = await pool.acquire('headless'); // grows worker-1
    assert.equal(pool.size, 2);
    // Queue a 3rd waiter — at capacity, so it parks.
    let resolved = null;
    const waiter = pool.acquire('headless').then(c => { resolved = c; });
    await new Promise(r => setTimeout(r, 5));
    assert.equal(resolved, null, 'waiter parked at capacity');
    // Kill the leased worker-1, then release it (dead-while-leased re-grow, I-2b).
    b.kill();
    pool.release(b);
    await waiter;
    assert.ok(resolved && !resolved.dead, 'waiter got a fresh live conn');
    pool.release(a); pool.release(resolved);
  });

  it('I-3: pending create failure rejects only the untargeted waiter', async () => {
    // primary exists; first worker create fails.
    const { pool } = newPool({ existingTargets: ['primary'], createThrows: 1 }, { maxTabs: 2 });
    await pool.ensurePrimary();
    const a = await pool.acquire('visible'); // take primary so headless must grow
    await assert.rejects(
      () => pool.acquire('headless'),
      (e) => e instanceof TvError && e.code === 'CDP_DOWN',
      'the untargeted waiter surfaces the create failure',
    );
    pool.release(a);
  });

  it('I-4: replay lock blocks a concurrent headless acquire until releaseReplay', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] }, { maxTabs: 3 });
    await pool.ensurePrimary();
    const replayConn = await pool.acquireReplay();
    let got = null;
    const blocked = pool.acquire('headless').then(c => { got = c; });
    await new Promise(r => setTimeout(r, 5));
    assert.equal(got, null, 'headless acquire blocked under replay lock');
    pool.releaseReplay(replayConn);
    await blocked;
    assert.ok(got, 'headless acquire proceeds after replay release');
    pool.release(got);
  });

  it('I-8: double-release idempotent; foreign release a no-op', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] });
    await pool.ensurePrimary();
    const a = await pool.acquire('visible');
    const before = pool._idle.length;
    pool.release(a);
    pool.release(a); // second release must not double-count
    assert.equal(pool._idle.length, before + 1);
    const stranger = new FakeConn();
    pool.release(stranger); // foreign → no-op
    assert.equal(pool._idle.length, before + 1);
  });

  it('OPS-2 / I-6: drain closes only self-created tabs, never the adopted primary', async () => {
    const { pool, state } = newPool({ existingTargets: ['primary'] }, { maxTabs: 3 });
    await pool.ensurePrimary();
    const w1 = await pool.acquire('headless'); // primary
    const w2 = await pool.acquire('headless'); // worker
    const w3 = await pool.acquire('headless'); // worker
    pool.release(w1); pool.release(w2); pool.release(w3);
    const workerIds = [...pool._createdTargetIds];
    assert.equal(workerIds.length, 2, 'two self-created workers tracked');
    await pool.drain(50);
    assert.deepEqual(state.closed.sort(), workerIds.sort(), 'only worker ids closed');
    assert.ok(!state.closed.includes('primary'), 'adopted primary never closed');
  });

  it('I-6: drain force-closes a stuck lease after the deadline and resolves', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] }, { maxTabs: 2 });
    await pool.ensurePrimary();
    const stuck = await pool.acquire('headless'); // leased, never released
    const start = Date.now();
    await pool.drain(120);
    assert.ok(Date.now() - start >= 100, 'waited out the deadline');
    assert.ok(stuck.disposed, 'stuck lease force-disposed');
  });

  it('drain rejects queued waiters with POOL_DRAINING', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] }, { maxTabs: 1 });
    await pool.ensurePrimary();
    const held = await pool.acquire('visible'); // only tab
    const waiter = pool.acquire('headless');
    const drained = pool.drain(20);
    await assert.rejects(
      () => waiter,
      (e) => e instanceof TvError && e.code === 'POOL_DRAINING',
    );
    await drained;
    pool.release(held);
  });

  it('CDP-3: ensurePrimary retries then throws CDP_DOWN after 5 failures', async () => {
    // listChartTargets fails on every attempt → all 5 retries exhaust.
    // Inject a no-op sleep so the exponential backoff doesn't cost ~15s of wall-clock.
    const { pool } = newPool({ existingTargets: [], listThrows: 99 }, { sleep: () => Promise.resolve() });
    await assert.rejects(
      () => pool.ensurePrimary(),
      (e) => e instanceof TvError && e.code === 'CDP_DOWN',
    );
  });

  it('CDP-3: ensurePrimary recovers on a later attempt after transient failures', async () => {
    // Fail the first 3 list calls, then adopt on the 4th.
    const { pool, state } = newPool(
      { existingTargets: ['primary'], listThrows: 3 },
      { sleep: () => Promise.resolve() },
    );
    const primary = await pool.ensurePrimary();
    assert.equal(primary.id, 'primary');
    assert.equal(state.createCalls, 0, 'adopted after transient failures, never created');
  });

  // ── TTL eviction (offline) ────────────────────────────────────────────────

  it('TTL: _pushIdle stamps idleSince; _take clears it', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] });
    await pool.ensurePrimary();

    // Primary lands in _idle via _pushIdle; idleSince should be stamped
    const primary = pool._idle[0];
    assert.ok(primary.idleSince > 0, 'primary idleSince stamped by _pushIdle');

    // acquire (via _take) clears it
    const c = await pool.acquire('visible');
    assert.equal(c.idleSince, null, 'idleSince cleared on lease');

    // release returns it to idle via _pushIdle
    pool.release(c);
    assert.ok(pool._idle[0].idleSince > 0, 'idleSince re-stamped after release');
  });

  it('TTL: _evictStaleWorkers removes idle workers past TTL, never primary', async () => {
    const { pool, state } = newPool({ existingTargets: ['primary'] }, { maxTabs: 3, workerTtlMs: 100 });
    await pool.ensurePrimary();

    // Grow a worker into idle (park primary first so headless actually grows)
    const vis = await pool.acquire('visible');
    const w = await pool.acquire('headless');
    const workerId = w.id;
    pool.release(w);    // worker goes idle with idleSince = now
    pool.release(vis);

    // Force idleSince to be stale
    pool._idle.find(c => c.id === workerId).idleSince = Date.now() - 1000;

    // Call evict directly
    pool._evictStaleWorkers();

    assert.ok(!pool._idle.some(c => c.id === workerId), 'stale worker removed from idle');
    assert.ok(!pool._createdTargetIds.has(workerId), 'stale worker removed from createdTargetIds');
    assert.ok(state.closed.includes(workerId), 'closeTarget called for stale worker');

    // Primary must survive
    assert.ok(pool._idle.some(c => c.id === 'primary'), 'primary still in idle');
  });

  it('TTL: primary is never evicted even when idleSince is stale', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] }, { workerTtlMs: 100 });
    await pool.ensurePrimary();

    // Force primary's idleSince to be very stale
    pool._primary.idleSince = Date.now() - 999999;
    pool._evictStaleWorkers();

    // Primary must still be in idle
    assert.ok(pool._idle.some(c => c.id === 'primary'), 'primary not evicted');
  });

  it('TTL: drain clears the TTL timer', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] }, { workerTtlMs: 5000 });
    await pool.ensurePrimary();
    assert.ok(pool._ttlTimer != null, 'TTL timer started');
    await pool.drain(100);
    assert.equal(pool._ttlTimer, null, 'TTL timer cleared by drain');
  });

  it('TTL: workerTtlMs=0 disables the TTL scanner', async () => {
    const { pool } = newPool({ existingTargets: ['primary'] }, { workerTtlMs: 0 });
    await pool.ensurePrimary();
    assert.equal(pool._ttlTimer, null, 'no timer started when TTL=0');
  });
});

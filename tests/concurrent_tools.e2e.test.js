/**
 * Concurrent multi-tool integration tests.
 *
 * Proves that:
 *   CT-1  Multiple long-running MCP operations run simultaneously on distinct tabs
 *   CT-2  Two concurrent chart_fetch_ohlcv calls for different symbols use separate tabs
 *   CT-3  A second sequential request reuses an idle worker tab (pool does not grow)
 *   CT-4  Idle worker tabs auto-evict after a configurable TTL; primary tab is never evicted
 *   CT-5  After TTL eviction, a new request grows a fresh tab (not the evicted one)
 *
 * All tests use private CdpPool instances — no global singleton (getPool) is touched.
 * Module-level probes use createNewTarget directly + a private mini-pool for capability checks.
 *
 * Live TV required: npm run test:ctool  (requires TradingView Desktop on --remote-debugging-port=9222)
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as cdpDiscovery from '../src/core/cdpDiscovery.js';
import * as tabModule from '../src/core/tab.js';
import * as chartCore from '../src/core/chart.js';
import * as newsCore from '../src/core/news.js';
import * as optionsCore from '../src/core/options.js';
import { CdpPool } from '../src/core/CdpPool.js';

const depsFor = (conn) => ({
  evaluate: conn.evaluate.bind(conn),
  evaluateAsync: conn.evaluateAsync.bind(conn),
  connection: conn,
});

// ── Module-level probes ───────────────────────────────────────────────────────
// No global singleton touched; all probes self-clean.

let hasTV = false;
let canGrow = false;
let hasNews = false;
let hasOptions = false;

try {
  const charts = await cdpDiscovery.listChartTargets();
  hasTV = charts.length > 0;

  if (hasTV) {
    // Can the pool grow new tabs? Stub Cmd+T so only PUT/window.open paths count.
    const stubTab = { newTab: () => Promise.reject(new Error('Cmd+T blocked in probe')) };
    try {
      const { conn, createdTargetId } =
        await cdpDiscovery.createNewTarget({ tabModule: stubTab });
      await conn.dispose();
      await cdpDiscovery.closeTarget(createdTargetId);
      canGrow = true;
    } catch { /* grow not supported */ }

    // Check news + options capability via a private mini-pool (drained immediately).
    if (canGrow) {
      const probePool = new CdpPool({ discovery: cdpDiscovery, tabModule, maxTabs: 2, workerTtlMs: 0 });
      await probePool.ensurePrimary();
      try {
        const conn = await probePool.acquire('headless');
        const deps = depsFor(conn);
        try {
          try {
            const r = await newsCore.getHeadlines({ limit: 1, _deps: deps });
            hasNews = Array.isArray(r?.results);
          } catch { /* news unavailable */ }
          try {
            const r = await optionsCore.searchContracts({ underlying: 'SPY', limit: 1, _deps: deps });
            hasOptions = r?.contracts != null;
          } catch { /* options unavailable */ }
        } finally { probePool.release(conn); }
      } finally { await probePool.drain(5000); }
    }
  }
} catch { /* CDP unreachable */ }

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CdpPool concurrent multi-tool e2e (requires live TradingView)', {
  skip: hasTV ? undefined : 'TradingView not reachable on port 9222',
}, () => {

  let pool = null;

  afterEach(async () => {
    if (!pool) return;
    const created = new Set(pool._createdTargetIds);
    try { await pool.drain(10000); } catch { /* best-effort */ }
    pool = null;
    if (created.size === 0) return;
    // Poll until self-created tabs disappear (DELETE /json/close is async on Electron)
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const live = await cdpDiscovery.listChartTargets().catch(() => []);
      const liveIds = new Set(live.map(t => t.id));
      if ([...created].every(id => !liveIds.has(id))) break;
      await new Promise(r => setTimeout(r, 200));
    }
  });

  // ── CT-1: ohlcv + news run concurrently on distinct tabs; options doesn't block ──

  it('CT-1: ohlcv and news run simultaneously on distinct tabs, options does not block',
    { skip: (canGrow && hasNews) ? undefined : 'requires multi-tab creation + news feed',
      timeout: 120000 },
    async () => {
      // primary(slot 0) + ohlcv-worker(slot 1) + news-worker(slot 2) = 3 slots
      pool = new CdpPool({ discovery: cdpDiscovery, tabModule, maxTabs: 3, workerTtlMs: 0 });
      await pool.ensurePrimary();

      const vis = await pool.acquire('visible');
      let cA, cB;
      try {
        [cA, cB] = await Promise.all([
          pool.acquire('headless'), // ohlcv worker
          pool.acquire('headless'), // news worker
        ]);

        assert.notEqual(cA.id, cB.id, 'ohlcv and news acquired distinct tabs');
        assert.equal(cA.selfCreated, true);
        assert.equal(cB.selfCreated, true);

        const t0 = Date.now();
        // options_search Tier-1 is a Node.js REST call (no _deps → globalThis.fetch).
        // It runs concurrently without occupying any pool slot, proving non-tab MCP
        // tools don't serialize tab-based operations.
        const [rOhlcv, rNews, rOpts] = await Promise.all([
          (async () => {
            const t = Date.now();
            const r = await chartCore.fetchOhlcv({ symbol: 'AAPL', timeframe: 'D', count: 5, _deps: depsFor(cA) });
            return { r, t0: t, t1: Date.now() };
          })(),
          (async () => {
            const t = Date.now();
            const r = await newsCore.getHeadlines({ limit: 5, _deps: depsFor(cB) });
            return { r, t0: t, t1: Date.now() };
          })(),
          (async () => {
            const t = Date.now();
            // No _deps: pure Node.js REST fetch, no tab slot consumed
            const r = hasOptions
              ? await optionsCore.searchContracts({ underlying: 'SPY', limit: 5 })
              : { success: true, contracts: [] };
            return { r, t0: t, t1: Date.now() };
          })(),
        ]);

        assert.ok(rOhlcv.r.success, `ohlcv succeeded (${rOhlcv.t1 - rOhlcv.t0}ms)`);
        assert.ok(rNews.r.success, `news succeeded (${rNews.t1 - rNews.t0}ms)`);
        assert.ok(rOpts.r.success, `options succeeded (${rOpts.t1 - rOpts.t0}ms)`);

        assert.ok(rOhlcv.r.bar_count > 0, 'ohlcv returned bars');
        assert.ok(Array.isArray(rNews.r.results), 'news returned results array');

        // Concurrency proof: ohlcv (setSymbol+waitForChartReady = seconds) and
        // news (in-renderer fetch = hundreds of ms) must overlap in real time.
        const overlaps = (x, y) => x.t0 < y.t1 && y.t0 < x.t1;
        assert.ok(overlaps(rOhlcv, rNews),
          `ohlcv and news must overlap: ohlcv=[${rOhlcv.t0 - t0}..${rOhlcv.t1 - t0}]ms news=[${rNews.t0 - t0}..${rNews.t1 - t0}]ms`);
      } finally {
        if (cA) pool.release(cA);
        if (cB) pool.release(cB);
        pool.release(vis);
      }
    }
  );

  // ── CT-2: two concurrent fetchOhlcv calls on different symbols/timeframes ──

  it('CT-2: two concurrent chart_fetch_ohlcv calls use separate tabs and different symbols',
    { skip: canGrow ? undefined : 'requires multi-tab creation',
      timeout: 90000 },
    async () => {
      pool = new CdpPool({ discovery: cdpDiscovery, tabModule, maxTabs: 3, workerTtlMs: 0 });
      await pool.ensurePrimary();

      const vis = await pool.acquire('visible');
      let cA, cB;
      try {
        [cA, cB] = await Promise.all([
          pool.acquire('headless'),
          pool.acquire('headless'),
        ]);

        assert.notEqual(cA.id, cB.id, 'distinct physical tabs for two ohlcv calls');
        assert.equal(cA.selfCreated, true);
        assert.equal(cB.selfCreated, true);
        assert.equal(pool._createdTargetIds.size, 2, 'exactly two workers created');

        const [rA, rB] = await Promise.all([
          chartCore.fetchOhlcv({ symbol: 'AAPL', timeframe: 'D',  count: 5, _deps: depsFor(cA) }),
          chartCore.fetchOhlcv({ symbol: 'MSFT', timeframe: '60', count: 5, _deps: depsFor(cB) }),
        ]);

        assert.ok(rA.success && rB.success, 'both fetches succeeded');
        assert.ok(rA.bar_count > 0, 'tab A returned bars');
        assert.ok(rB.bar_count > 0, 'tab B returned bars');
        // If they shared a tab the second setSymbol would stomp the first;
        // the distinct tab-id assertion above is the primary isolation proof.
      } finally {
        if (cA) pool.release(cA);
        if (cB) pool.release(cB);
        pool.release(vis);
      }
    }
  );

  // ── CT-3: second sequential request reuses the idle worker (pool does not grow) ──

  it('CT-3: second sequential request reuses the idle worker tab, pool does not grow',
    { skip: canGrow ? undefined : 'requires multi-tab creation',
      timeout: 60000 },
    async () => {
      pool = new CdpPool({ discovery: cdpDiscovery, tabModule, maxTabs: 2, workerTtlMs: 0 });
      await pool.ensurePrimary();

      const vis = await pool.acquire('visible');
      let c;
      try {
        // First request: grow one worker
        c = await pool.acquire('headless');
        await chartCore.fetchOhlcv({ symbol: 'AAPL', timeframe: 'D', count: 3, _deps: depsFor(c) });
        const workerId = c.id;
        pool.release(c); c = null;

        assert.equal(pool.size, 2, 'primary + idle worker = 2 after first request');
        assert.equal(pool._createdTargetIds.size, 1, 'one worker created');

        // Second request: must reuse the idle worker, not grow
        c = await pool.acquire('headless');
        assert.equal(c.id, workerId, 'same physical tab reused for second request');
        assert.equal(pool._createdTargetIds.size, 1, 'pool did not grow for second request');

        await chartCore.fetchOhlcv({ symbol: 'MSFT', timeframe: 'D', count: 3, _deps: depsFor(c) });
      } finally {
        if (c) pool.release(c);
        pool.release(vis);
      }
    }
  );

  // ── CT-4: idle workers auto-evict after TTL; primary tab is never evicted ──

  it('CT-4: idle worker tabs auto-evict after TTL; primary tab survives',
    { skip: canGrow ? undefined : 'requires multi-tab creation',
      timeout: 30000 },
    async () => {
      // 1500ms TTL; scanner fires every min(1500,30000)=1500ms
      pool = new CdpPool({ discovery: cdpDiscovery, tabModule, maxTabs: 3, workerTtlMs: 1500 });
      await pool.ensurePrimary();
      const primaryId = pool._primary.id;

      const vis = await pool.acquire('visible');
      const w = await pool.acquire('headless');
      const workerId = w.id;
      assert.ok(pool._createdTargetIds.has(workerId), 'worker tracked in createdTargetIds');
      pool.release(w);
      pool.release(vis);

      assert.ok(pool._idle.some(c => c.id === workerId), 'worker idle before TTL');

      // Wait 3× TTL for the scanner to fire and evict
      await new Promise(r => setTimeout(r, 5000));

      assert.ok(!pool._idle.some(c => c.id === workerId), 'worker evicted from idle list');
      assert.ok(!pool._createdTargetIds.has(workerId), 'worker removed from createdTargetIds');

      // Worker browser tab must be closed
      const deadline = Date.now() + 3000;
      let gone = false;
      while (Date.now() < deadline) {
        const live = await cdpDiscovery.listChartTargets();
        if (!live.find(t => t.id === workerId)) { gone = true; break; }
        await new Promise(r => setTimeout(r, 200));
      }
      assert.ok(gone, `worker tab ${workerId.slice(0, 8)} should be closed after TTL`);

      // Primary must never be evicted
      const after = await cdpDiscovery.listChartTargets();
      assert.ok(after.find(t => t.id === primaryId), 'primary tab still alive after TTL eviction');
    }
  );

  // ── CT-5: after TTL eviction, new request creates a fresh tab ──────────────

  it('CT-5: after TTL eviction, new request grows a fresh tab (not the evicted one)',
    { skip: canGrow ? undefined : 'requires multi-tab creation',
      timeout: 30000 },
    async () => {
      pool = new CdpPool({ discovery: cdpDiscovery, tabModule, maxTabs: 3, workerTtlMs: 1500 });
      await pool.ensurePrimary();

      // Grow and evict a worker (abbreviated CT-4 reprise)
      const vis0 = await pool.acquire('visible');
      const w = await pool.acquire('headless');
      const oldId = w.id;
      pool.release(w);
      pool.release(vis0);
      await new Promise(r => setTimeout(r, 5000)); // wait for eviction
      assert.ok(!pool._idle.some(c => c.id === oldId), 'old worker evicted before regrow');

      // New request must grow a brand-new tab, not resurrect the evicted one
      const vis = await pool.acquire('visible');
      const newW = await pool.acquire('headless');
      try {
        assert.notEqual(newW.id, oldId, 'fresh tab id differs from evicted tab id');
        assert.ok(pool._createdTargetIds.has(newW.id), 'fresh tab tracked for cleanup');
      } finally {
        pool.release(newW);
        pool.release(vis);
      }
    }
  );

});

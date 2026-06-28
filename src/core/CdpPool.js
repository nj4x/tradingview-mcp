// src/core/CdpPool.js
import * as discovery from './cdpDiscovery.js';
import { TvError } from './TvError.js';

const MAX_TABS = Math.max(1, Number(process.env.TV_MCP_MAX_TABS || 3));
const TAB_TIMEOUT_MS = Number(process.env.TV_MCP_TAB_TIMEOUT_MS || 20000);
const DRAIN_TIMEOUT_MS = Number(process.env.TV_MCP_DRAIN_TIMEOUT_MS || 8000);

export class CdpPool {
  /**
   * @param {{ tabModule: object, discovery?: object, maxTabs?: number }} deps
   *   tabModule  = core/tab.js (for Cmd+T fallback); injectable for tests
   *   discovery  = cdpDiscovery (injectable for tests)
   */
  constructor(deps = {}) {
    this.maxTabs = deps.maxTabs || MAX_TABS;
    this._tabModule = deps.tabModule;
    this._discovery = deps.discovery || discovery;
    // Injectable sleep so tests can collapse the ensurePrimary backoff (default: real timer).
    this._sleep = deps.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));

    this._idle = [];          // CdpConnection[] available to lease
    this._used = new Set();   // CdpConnection[] currently leased
    this._waiters = [];       // { route, wantId, resolve, reject, timer }
    this._pendingCount = 0;   // in-flight tab creations (I-1: ALL paths increment this)
    this._primary = null;     // adopted user tab (slot 0); never self-closed
    this._primaryInitPromise = null; // one-shot guard: in-flight ensurePrimary (M2)
    this._createdTargetIds = new Set(); // self-made tabs to close on drain (OPS-2)
    this._replayLock = null;  // null | { tabId, waiters: [] }  (I-4 global exclusive)
    this._draining = false;
  }

  // size counts idle + leased + in-flight creations so capacity checks are race-free.
  get size() { return this._idle.length + this._used.size + this._pendingCount; }

  /**
   * Ensure the primary (visible) tab exists and return it. Adopts the first existing
   * chart target; if none exist, creates one. 5-retry exponential backoff (CDP-3).
   * Creation increments _pendingCount so it can't push size past maxTabs (I-1).
   *
   * Re-entrancy (M2): concurrent callers share ONE in-flight _primaryInitPromise so
   * _doEnsurePrimary (and thus Cmd+T) runs exactly once. The promise is nulled on
   * settle, so a failed init can be retried by a subsequent call.
   */
  async ensurePrimary() {
    if (this._primary && !this._primary.dead) return this._primary;

    if (this._primaryInitPromise) return this._primaryInitPromise;
    this._primaryInitPromise = this._doEnsurePrimary();
    try {
      await this._primaryInitPromise;
    } finally {
      this._primaryInitPromise = null;
    }
    return this._primary;
  }

  /** Actual adopt-or-create with 5-retry exponential backoff (CDP-3). */
  async _doEnsurePrimary() {
    let lastErr;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const targets = await this._discovery.listChartTargets();
        if (targets.length > 0) {
          // Adopt the first existing user tab as primary. NOT self-created → never closed.
          this._primary = await this._discovery.attach(targets[0], { role: 'primary' });
          this._wireDisconnect(this._primary);
          this._idle.push(this._primary);
          return this._primary;
        }
        // No tab at all → create one, counting it against capacity (I-1).
        this._pendingCount += 1;
        try {
          const { conn } =
            await this._discovery.createNewTarget({ tabModule: this._tabModule });
          conn.role = 'primary';
          // We do NOT add it to _createdTargetIds: it is the user's ONLY chart, so it
          // must never be auto-closed on drain (OPS-2 / T-NEW-12).
          this._primary = conn;
          this._wireDisconnect(conn);
          this._idle.push(conn);
          return conn;
        } finally {
          this._pendingCount -= 1;
        }
      } catch (err) {
        lastErr = err;
        const delay = Math.min(500 * 2 ** attempt, 30000);
        await this._sleep(delay);
      }
    }
    throw TvError.from(lastErr, 'CDP_DOWN');
  }

  _wireDisconnect(conn) {
    conn.once('disconnect', () => {
      conn.dead = true;
      const wasIdle = this._idle.indexOf(conn);
      if (wasIdle >= 0) this._idle.splice(wasIdle, 1);
      if (this._primary === conn) this._primary = null;
      // If it died while idle and waiters are queued, grow a replacement now (I-2).
      // If it died while LEASED, release() handles the re-grow when the lease returns.
      if (wasIdle >= 0) this._maybeGrowForWaiters();
    });
  }

  /**
   * Lease a connection for the given route.
   *   'visible'  → the primary tab (slot 0). Serializes with other visible ops.
   *   'headless' → any non-primary idle tab; grow up to maxTabs; else queue.
   *   { tabId }  → exact tab. Fast-fail TARGET_GONE if it doesn't exist (I-5).
   *
   * Replay global lock (I-4): if a replay lock is held, every acquire BLOCKS (queues
   * on the replay lock) until replay_stop releases it — EXCEPT an acquire for the
   * replay-owning tabId, which proceeds. New acquires don't fail, they wait.
   */
  async acquire(route = 'headless') {
    if (this._draining) {
      throw new TvError('POOL_DRAINING', 'pool is shutting down');
    }

    // Global replay gate (I-4).
    if (this._replayLock) {
      const ownerId = this._replayLock.tabId;
      const targetsOwner = isTabRoute(route) && route.tabId === ownerId;
      if (!targetsOwner) {
        await this._waitForReplayRelease();  // block, then retry same route
        return this.acquire(route);
      }
    }

    if (route === 'visible') return this._acquireVisible();
    if (isTabRoute(route)) return this._acquirePinned(route.tabId);
    return this._acquireHeadless();
  }

  async _acquireVisible() {
    const primary = await this.ensurePrimary();
    if (this._idle.includes(primary)) return this._take(primary, 'visible');
    // Primary is busy → queue a targeted waiter for it.
    return this._enqueueWaiter('visible', primary.id);
  }

  _acquirePinned(tabId) {
    const idle = this._idle.find(c => c.id === tabId);
    if (idle) return Promise.resolve(this._take(idle, { tabId }));
    const leased = [...this._used].find(c => c.id === tabId);
    if (leased) return this._enqueueWaiter({ tabId }, tabId);
    // Not idle, not leased, and we can't predict a pending tab's id → it's gone (I-5).
    return Promise.reject(new TvError('TARGET_GONE',
      `pinned tab ${tabId} is not idle, leased, or pending`, { meta: { tabId } }));
  }

  async _acquireHeadless() {
    // Prefer a non-primary idle worker; fall back to any idle (incl. primary).
    const worker = this._idle.find(c => c.role !== 'primary') || this._idle[0];
    if (worker) return this._take(worker, 'headless');

    // Grow if we have headroom (I-1: _pendingCount is part of size).
    if (this.size < this.maxTabs) return this._growHeadless();

    // At capacity → queue an untargeted waiter.
    return this._enqueueWaiter('headless', null);
  }

  /** Create a new worker tab, counting it against capacity the whole time (I-1). */
  async _growHeadless() {
    this._pendingCount += 1;
    try {
      const { conn, createdTargetId } =
        await this._discovery.createNewTarget({
          tabModule: this._tabModule,
          sourceTargetId: this._primary?.id,
        });
      this._createdTargetIds.add(createdTargetId); // OPS-2: track for cleanup
      this._wireDisconnect(conn);
      this._idle.push(conn);
      return this._take(conn, 'headless');
    } catch (err) {
      // The create failed; reject the head UNTARGETED waiter so it doesn't starve (I-3).
      this._failPendingSlot(err);
      throw TvError.from(err, 'CDP_DOWN');
    } finally {
      this._pendingCount -= 1;
    }
  }

  _take(conn, route) {
    const i = this._idle.indexOf(conn);
    if (i >= 0) this._idle.splice(i, 1);
    this._used.add(conn);
    conn.route = route;
    return conn;
  }

  _enqueueWaiter(route, wantId) {
    return new Promise((resolve, reject) => {
      const waiter = { route, wantId, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const idx = this._waiters.indexOf(waiter);
        if (idx >= 0) this._waiters.splice(idx, 1);
        reject(new TvError('POOL_EXHAUSTED',
          `no tab available within ${TAB_TIMEOUT_MS}ms for route ${routeLabel(route)}`,
          { meta: { route } }));
      }, TAB_TIMEOUT_MS);
      this._waiters.push(waiter);
      this._serviceWaiters(); // serviceable immediately if a tab freed between checks
    });
  }

  /** Hand idle tabs to compatible waiters, oldest-first. */
  _serviceWaiters() {
    for (let i = 0; i < this._waiters.length; ) {
      const w = this._waiters[i];
      const conn = this._matchIdle(w);
      if (!conn) { i += 1; continue; }
      clearTimeout(w.timer);
      this._waiters.splice(i, 1);
      w.resolve(this._take(conn, w.route));
    }
  }

  _matchIdle(w) {
    if (w.wantId) return this._idle.find(c => c.id === w.wantId) || null;
    // Untargeted (headless): prefer a worker, else any idle.
    return this._idle.find(c => c.role !== 'primary') || this._idle[0] || null;
  }

  /**
   * I-2 fix: a tab DIED while waiters are queued and capacity is now free.
   * Grow a replacement (entering the create path with _pendingCount) so the oldest
   * untargeted waiter gets serviced instead of starving to timeout.
   */
  _maybeGrowForWaiters() {
    const hasUntargeted = this._waiters.some(w => !w.wantId);
    if (!hasUntargeted) return;
    if (this.size >= this.maxTabs) return;
    if (this._draining) return;
    // NB: do NOT call _growHeadless() here — that _take()s the conn for the *caller*,
    // but there is no caller (we're replacing a dead tab on a queued waiter's behalf).
    // _growForWaiter pushes the fresh tab to _idle and lets _serviceWaiters hand it out.
    this._growForWaiter();
  }

  /** Create a replacement worker FOR a queued waiter: land it in _idle, then service. */
  async _growForWaiter() {
    this._pendingCount += 1;
    try {
      const { conn, createdTargetId } =
        await this._discovery.createNewTarget({
          tabModule: this._tabModule,
          sourceTargetId: this._primary?.id,
        });
      this._createdTargetIds.add(createdTargetId); // OPS-2: track for cleanup
      this._wireDisconnect(conn);
      this._idle.push(conn);
      this._serviceWaiters(); // oldest compatible waiter claims it
    } catch (err) {
      // The replacement create failed → surface to the head untargeted waiter (I-3).
      this._failPendingSlot(err);
    } finally {
      this._pendingCount -= 1;
    }
  }

  /**
   * I-3 fix: a pending tab open FAILED. Reject only the first UNTARGETED waiter
   * (the one that would have used that anonymous slot) — never a pinned/visible waiter
   * that is waiting for a specific, still-alive tab. Then re-service in case other
   * idle capacity covers remaining waiters.
   */
  _failPendingSlot(err) {
    const idx = this._waiters.findIndex(w => !w.wantId);
    if (idx >= 0) {
      const w = this._waiters[idx];
      clearTimeout(w.timer);
      this._waiters.splice(idx, 1);
      w.reject(TvError.from(err, 'CDP_DOWN'));
    }
    this._serviceWaiters();
  }

  /**
   * Return a leased connection. Idempotent for double-release; no-op for foreign conns
   * (T-NEW-8). If the released tab is DEAD and waiters are queued with free capacity,
   * grow a replacement (I-2) instead of just returning it to idle.
   */
  release(conn) {
    if (!conn || !this._used.has(conn)) return; // foreign or already released → no-op
    this._used.delete(conn);
    conn.route = null;

    if (conn.dead) {
      if (this._primary === conn) this._primary = null;
      this._maybeGrowForWaiters();  // I-2: free capacity + waiting → replace the tab
      this._serviceWaiters();
      return;
    }

    this._idle.push(conn);
    this._serviceWaiters();
  }

  /**
   * Acquire the GLOBAL replay lock and a lease on the visible tab. While held, every
   * non-owner acquire BLOCKS until releaseReplay() (I-4). Returns the owning connection.
   * Replay runs on the visible tab because _replayApi is session-global in the renderer,
   * so a worker tab buys nothing and the replay UI is user-facing.
   */
  async acquireReplay() {
    if (this._replayLock) {
      await this._waitForReplayRelease(); // another replay owns it → wait, then retry
      return this.acquireReplay();
    }
    const conn = await this._acquireVisible();
    this._replayLock = { tabId: conn.id, waiters: [] };
    return conn;
  }

  /** Release the global replay lock + the lease, and wake everyone blocked on it. */
  releaseReplay(conn) {
    if (this._replayLock && conn) this.release(conn);
    const lock = this._replayLock;
    this._replayLock = null;
    if (lock) for (const { resolve } of lock.waiters) resolve();
    this._serviceWaiters();
  }

  // Waiters are stored as { resolve, reject } so drain() can reject them with
  // POOL_DRAINING (rather than leaving them to time out into POOL_EXHAUSTED).
  _waitForReplayRelease() {
    return new Promise((resolve, reject) => {
      if (!this._replayLock) return resolve();
      this._replayLock.waiters.push({ resolve, reject });
    });
  }

  /**
   * Graceful shutdown. Stop accepting new acquires, wait up to deadlineMs for leased
   * ops to return, then FORCE-close anything still leased (I-6). Always resolves.
   * Closes ONLY self-created browser tabs (OPS-2 / T-NEW-12), never the adopted primary.
   */
  async drain(deadlineMs = DRAIN_TIMEOUT_MS) {
    this._draining = true;

    // Reject queued waiters immediately — they can't be served during shutdown.
    for (const w of this._waiters.splice(0)) {
      clearTimeout(w.timer);
      w.reject(new TvError('POOL_DRAINING', 'pool draining'));
    }

    // Flush any acquires blocked on the replay gate (callers parked in
    // _waitForReplayRelease). Without this they wait out TAB_TIMEOUT_MS and get
    // POOL_EXHAUSTED instead of the correct POOL_DRAINING.
    if (this._replayLock) {
      const drained = this._replayLock.waiters.splice(0);
      for (const { reject } of drained) {
        reject(new TvError('POOL_DRAINING', 'Pool is draining', { retryable: false }));
      }
      this._replayLock = null;
    }

    const start = Date.now();
    while (this._used.size > 0 && Date.now() - start < deadlineMs) {
      await new Promise(r => setTimeout(r, 50)); // poll every 50ms (I-6)
    }

    // Force-detach whatever remains (idle + still-leased past the deadline).
    const all = [...this._idle, ...this._used];
    this._idle = [];
    this._used.clear();
    await Promise.all(all.map(c => c.dispose().catch(() => {})));

    // OPS-2: close ONLY browser tabs WE created. Never the adopted primary/user tabs.
    await Promise.all([...this._createdTargetIds].map(id =>
      this._discovery.closeTarget(id).catch(() => {})));
    this._createdTargetIds.clear();
    this._primary = null;
    this._replayLock = null;
  }
}

// --- helpers ---
function isTabRoute(r) { return r && typeof r === 'object' && typeof r.tabId === 'string'; }
function routeLabel(r) { return isTabRoute(r) ? `tab:${r.tabId}` : String(r); }

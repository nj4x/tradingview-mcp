// src/core/replaySession.js
import * as replay from './replay.js';
import { TvError } from './TvError.js';

const REPLAY_IDLE_EXPIRY_MS = Number(process.env.TV_MCP_REPLAY_EXPIRY_MS || 10 * 60 * 1000);

/**
 * Holds the pool's global replay lock + the pinned connection for the duration of a
 * replay session. All replay_* tools route through here so they share one leased tab.
 */
export class ReplaySession {
  constructor(pool) {
    this.pool = pool;
    this.conn = null;          // pinned, replay-owning connection
    this._expiryTimer = null;
  }

  get active() { return !!this.conn; }

  _bumpExpiry() {
    clearTimeout(this._expiryTimer);
    this._expiryTimer = setTimeout(() => {
      // Auto-expire a forgotten replay session so the global lock can't wedge the pool.
      this.stop().catch(() => {});
    }, REPLAY_IDLE_EXPIRY_MS);
  }

  /** replay_start: take the global lock + pin the visible tab, then start replay. */
  async start(args) {
    if (this.active) {
      // Re-entrant start on the same session is allowed (restart on the held tab).
      return this._run((deps) => replay.start({ ...args, _deps: deps }));
    }
    this.conn = await this.pool.acquireReplay(); // global lock (I-4)
    this._bumpExpiry();
    try {
      return await this._run((deps) => replay.start({ ...args, _deps: deps }));
    } catch (err) {
      await this.stop().catch(() => {});
      throw err;
    }
  }

  step(args)  { return this._guard((d) => replay.step({ ...args, _deps: d })); }
  autoplay(a) { return this._guard((d) => replay.autoplay({ ...a, _deps: d })); }
  trade(a)    { return this._guard((d) => replay.trade({ ...a, _deps: d })); }
  status(a)   { return this._guard((d) => replay.status({ ...a, _deps: d })); }

  /**
   * replay_run (I-7): drive the whole autoplay loop on the ONE held connection.
   * The inner start/autoplay/status/stop primitives all receive the SAME _deps bound
   * to this.conn, so no inner call ever re-acquires the tab → no self-deadlock.
   */
  async run(args) {
    if (!this.active) {
      this.conn = await this.pool.acquireReplay();
      this._bumpExpiry();
    }
    const base = this._deps();
    // replay.run() resolves its primitives from _deps; inject held-connection-bound
    // versions so the entire loop stays on this.conn (I-7).
    return replay.run({
      ...args,
      _deps: {
        ...base,
        start:    (a) => replay.start({ ...a, _deps: this._deps() }),
        autoplay: (a) => replay.autoplay({ ...a, _deps: this._deps() }),
        status:   (a) => replay.status({ ...a, _deps: this._deps() }),
        stop:     (a) => replay.stop({ ...a, _deps: this._deps() }),
      },
    });
  }

  /** replay_stop: stop replay, release the global lock + the pinned lease (I-4). */
  async stop(args = {}) {
    if (!this.active) return { success: true, action: 'already_stopped' };
    clearTimeout(this._expiryTimer);
    const conn = this.conn;
    try {
      return await this._run((d) => replay.stop({ ...args, _deps: d }));
    } finally {
      this.conn = null;
      this.pool.releaseReplay(conn); // releases lock + lease, wakes blocked acquires
    }
  }

  _guard(fn) {
    if (!this.active) {
      return Promise.reject(new TvError('REPLAY_ACTIVE',
        'no active replay session; call replay_start first', { retryable: false }));
    }
    return this._run(fn);
  }

  async _run(fn) {
    this._bumpExpiry();
    return fn(this._deps());
  }

  /** _deps bound to the pinned replay connection. */
  _deps() {
    const conn = this.conn;
    return {
      evaluate: (expr, opts) => conn.evaluate(expr, opts),
      evaluateAsync: (expr) => conn.evaluateAsync(expr),
    };
  }
}

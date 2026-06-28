// src/core/CdpConnection.js
import { EventEmitter } from 'node:events';
import { TvError } from './TvError.js';

const DEFAULT_EVAL_TIMEOUT = Number(process.env.TV_MCP_EVAL_TIMEOUT_MS || 15000);

/**
 * One CDP connection to one TradingView chart target.
 * - run(fn): serial queue; fn receives the raw CDP client. Per-op timeout applies.
 * - evaluate / evaluateAsync: convenience wrappers used by core _deps injection.
 * - 'disconnect' event: fired once when the client drops (CDP-level disconnect).
 */
export class CdpConnection extends EventEmitter {
  /**
   * @param {object} client  chrome-remote-interface client
   * @param {object} target  { id, url, title } CDP target descriptor
   * @param {{ role?: 'primary'|'worker', evalTimeoutMs?: number, selfCreated?: boolean }} opts
   */
  constructor(client, target, opts = {}) {
    super();
    this.client = client;
    this.target = target;
    this.id = target.id;
    this.role = opts.role || 'worker';
    this.selfCreated = !!opts.selfCreated;
    this.evalTimeoutMs = opts.evalTimeoutMs || DEFAULT_EVAL_TIMEOUT;
    this.dead = false;
    this.route = null;          // set by the pool while leased: 'visible'|'headless'|{tabId}
    this._chain = Promise.resolve(); // serial queue tail
    this._depth = 0;            // outstanding queued ops; chain resets to fresh when 0

    // Surface CDP-level disconnects as a single 'disconnect' event + dead flag.
    if (typeof client.on === 'function') {
      client.on('disconnect', () => this._markDead('cdp-disconnect'));
      client.on('error', () => this._markDead('cdp-error'));
    }
  }

  _markDead(reason) {
    if (this.dead) return;
    this.dead = true;
    this.emit('disconnect', reason);
  }

  /**
   * Enqueue fn on the serial chain. fn(client) runs after all prior ops on this tab.
   * Per-op timeout: if fn doesn't settle within evalTimeoutMs, reject CHART_TIMEOUT.
   * The tab stays usable for the NEXT op (we don't kill the connection on a timeout —
   * the hung op is abandoned but the chain advances).
   */
  run(fn) {
    if (this.dead) {
      return Promise.reject(new TvError('CDP_DOWN', `tab ${this.id} is dead`));
    }
    this._depth += 1;
    const result = this._chain.then(() => this._withTimeout(fn));
    // Swallow the result on the chain itself so one rejection doesn't poison the next op.
    this._chain = result.then(noop, noop).then(() => {
      this._depth -= 1;
      // Bounded chain: when the queue fully drains, reset to a fresh resolved promise
      // so we never accumulate an ever-deepening .then() graph.
      if (this._depth === 0) this._chain = Promise.resolve();
    });
    return result;
  }

  _withTimeout(fn) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new TvError('CHART_TIMEOUT',
          `evaluate exceeded ${this.evalTimeoutMs}ms on tab ${this.id}`,
          { meta: { tabId: this.id } }));
      }, this.evalTimeoutMs);
    });
    return Promise.race([Promise.resolve().then(() => fn(this.client)), timeout])
      .finally(() => clearTimeout(timer));
  }

  /** evaluate(expr) — same contract as connection.evaluate, but tab-scoped + queued. */
  evaluate(expression, opts = {}) {
    return this.run(async (c) => {
      const r = await c.Runtime.evaluate({
        expression,
        returnByValue: true,
        awaitPromise: opts.awaitPromise ?? false,
        ...opts,
      });
      if (r.exceptionDetails) {
        const msg = r.exceptionDetails.exception?.description
          || r.exceptionDetails.text || 'Unknown evaluation error';
        throw new TvError('JS_EVAL', `JS evaluation error: ${msg}`,
          { meta: { tabId: this.id } });
      }
      return r.result?.value;
    });
  }

  evaluateAsync(expression) {
    return this.evaluate(expression, { awaitPromise: true });
  }

  /** Detach CDP (does NOT close the browser tab — pool handles tab lifecycle). */
  async dispose() {
    this._markDead('dispose');
    try { await this.client.close(); } catch { /* already gone */ }
  }
}

function noop() {}

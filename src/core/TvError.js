// src/core/TvError.js

/**
 * Stable error codes surfaced to MCP tool callers.
 * retryable = the same call may succeed if retried after a short delay.
 */
const RETRYABLE = new Set(['POOL_EXHAUSTED', 'POOL_DRAINING', 'CHART_TIMEOUT']);

export const TV_ERROR_CODES = Object.freeze({
  POOL_EXHAUSTED: 'POOL_EXHAUSTED', // no free tab within tab-timeout
  POOL_DRAINING: 'POOL_DRAINING',   // acquire during shutdown
  CHART_TIMEOUT: 'CHART_TIMEOUT',   // per-op evaluate timed out / readiness timed out
  CDP_DOWN: 'CDP_DOWN',             // CDP unreachable; TradingView likely not running
  TARGET_GONE: 'TARGET_GONE',       // pinned tab no longer exists
  JS_EVAL: 'JS_EVAL',               // exception thrown inside the renderer
  REPLAY_ACTIVE: 'REPLAY_ACTIVE',   // global replay lock held by another session
});

export class TvError extends Error {
  /**
   * @param {string} code  one of TV_ERROR_CODES
   * @param {string} message
   * @param {{ cause?: any, retryable?: boolean, meta?: object }} [opts]
   */
  constructor(code, message, opts = {}) {
    super(message);
    this.name = 'TvError';
    this.code = code;
    this.retryable = opts.retryable ?? RETRYABLE.has(code);
    if (opts.cause !== undefined) this.cause = opts.cause;
    if (opts.meta) this.meta = opts.meta;
  }

  /** Normalize any thrown value into a TvError (default JS_EVAL, non-retryable). */
  static from(err, fallbackCode = 'JS_EVAL') {
    if (err instanceof TvError) return err;
    const msg = err?.message || String(err);
    return new TvError(fallbackCode, msg, { cause: err });
  }
}

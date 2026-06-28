// src/core/withTab.js
import { getPool, getLegacyDeps, isPoolDisabled } from '../connection.js';
import { TvError } from './TvError.js';

/**
 * Run `fn(deps)` with a leased tab's connection injected as deps.
 *
 * @param {(deps) => Promise<any>} fn  receives { evaluate, evaluateAsync, connection }
 * @param {{ route?: 'visible'|'headless'|{tabId:string}, connection?: object, symbol?: string }} opts
 *   route       placement intent (default 'headless')
 *   connection  pre-held connection (replay_run inner calls) → bypass acquire/release
 *   symbol      affinity hint: prefer an idle tab already on this symbol (headless route)
 */
export async function withTab(fn, opts = {}) {
  const { route = 'headless', connection, symbol } = opts;

  // I-7: caller already holds a lease (e.g. replay_run loop) → reuse it, don't acquire.
  if (connection) {
    return fn(depsFor(connection));
  }

  // OPS-3 kill switch: pool disabled → legacy singleton path, pool never instantiated.
  if (isPoolDisabled()) {
    return fn(getLegacyDeps());
  }

  const pool = getPool();
  let conn;
  try {
    conn = await pool.acquire(route, { symbol });
  } catch (err) {
    throw TvError.from(err, 'POOL_EXHAUSTED');
  }
  try {
    return await fn(depsFor(conn));
  } finally {
    pool.release(conn);
  }
}

function depsFor(conn) {
  return {
    connection: conn,
    evaluate: (expr, o) => conn.evaluate(expr, o),
    evaluateAsync: (expr) => conn.evaluateAsync(expr),
    setSymbolHint: (s) => conn.setSymbolHint?.(s),
    captureScreenshot: (params) => conn.run(c => c.Page.captureScreenshot(params ?? {})),
  };
}

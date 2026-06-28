/**
 * withTab + kill-switch tests (PHASE 1 Wave 5). Offline.
 *
 * Covers OPS-3 (TV_MCP_POOL=0 bypass → legacy singleton, pool never constructed) and
 * I-7 (caller-supplied `connection` bypasses acquire/release). The pooled-route path
 * is exercised by pool.test.js; here we only prove the two bypass branches, which is
 * all that can run without a live CDP endpoint.
 *
 * Run: node --test tests/withtab.test.js
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { withTab } from '../src/core/withTab.js';

const ORIG = process.env.TV_MCP_POOL;
afterEach(() => {
  if (ORIG === undefined) delete process.env.TV_MCP_POOL;
  else process.env.TV_MCP_POOL = ORIG;
});

describe('withTab', () => {
  it('OPS-3: TV_MCP_POOL=0 → legacy deps, evaluate/evaluateAsync present', async () => {
    process.env.TV_MCP_POOL = '0';
    let injected;
    const out = await withTab((deps) => { injected = deps; return 'ok'; }, { route: 'headless' });
    assert.equal(out, 'ok');
    assert.equal(typeof injected.evaluate, 'function');
    assert.equal(typeof injected.evaluateAsync, 'function');
    // Legacy path injects the singleton fns, NOT a leased connection object.
    assert.equal(injected.connection, undefined);
  });

  it('I-7: a caller-supplied connection bypasses acquire/release', async () => {
    // No env / pool needed: the connection branch returns before getPool() is touched.
    const fakeConn = {
      evaluate: (e) => Promise.resolve(`eval:${e}`),
      evaluateAsync: (e) => Promise.resolve(`evalAsync:${e}`),
    };
    let injected;
    const out = await withTab((deps) => { injected = deps; return deps.evaluate('1+1'); },
      { connection: fakeConn });
    assert.equal(out, 'eval:1+1');
    assert.equal(injected.connection, fakeConn, 'held connection is passed through');
    assert.equal(await injected.evaluateAsync('x'), 'evalAsync:x');
  });

  it('I-7: the connection bypass ignores route entirely', async () => {
    const fakeConn = { evaluate: () => Promise.resolve('v'), evaluateAsync: () => Promise.resolve('v') };
    const out = await withTab((deps) => deps.evaluate(), { route: 'visible', connection: fakeConn });
    assert.equal(out, 'v');
  });
});

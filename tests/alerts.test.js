/**
 * Offline unit tests for the REST path of alerts.list().
 *
 * Verifies:
 * 1. TV_MCP_REST=0 → list() throws TvError(REST_DISABLED) — NOT swallowed by the
 *    soft-failure catch block (assertRestEnabled runs before the try/catch).
 * 2. Happy path: data.s='ok' with one alert → mapped alert, source=rest_api.
 * 3. JSON-encoded symbol ('={"type":"symbol","symbol":"NASDAQ:TSLA"}') → decoded.
 * 4. data.s !== 'ok' → soft-failure shape with empty alerts.
 * 5. Non-2xx REST error (HTTP 403) → soft-failure shape (does NOT throw).
 * 6. Empty data.r=[] → alert_count=0, alerts=[].
 *
 * All tests run offline via DI (_deps: { evaluate, evaluateAsync }).
 * Run: node --test tests/alerts.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/core/alerts.js';
import { TvError } from '../src/core/TvError.js';

// Ensure REST is enabled for the non-disabled tests (clear any inherited =0 flag).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/**
 * Build a mock evaluateAsync that returns the REST envelope restFromRenderer expects:
 * { __ok, status, data }.
 */
function makeEvalAsync(data, { ok = true, status = 200 } = {}) {
  return async (_expr) => ({ __ok: ok, status, data });
}

// evaluateAsync that must never be called (used for the REST_DISABLED test).
const noEvalAsync = async () => { throw new Error('evaluateAsync should not be called when REST is disabled'); };

// ---------------------------------------------------------------------------
// 1. TV_MCP_REST=0 → throws TvError(REST_DISABLED), not caught by soft-failure
// ---------------------------------------------------------------------------
describe('alerts.list() — TV_MCP_REST=0 throws REST_DISABLED', () => {
  it('propagates TvError(REST_DISABLED) and never calls the fetch', async () => {
    process.env.TV_MCP_REST = '0';
    try {
      await assert.rejects(
        () => core.list({ _deps: { evaluateAsync: noEvalAsync } }),
        (err) => {
          assert.ok(err instanceof TvError, 'should be a TvError');
          assert.equal(err.code, 'REST_DISABLED');
          return true;
        },
      );
    } finally {
      delete process.env.TV_MCP_REST;
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path: one alert
// ---------------------------------------------------------------------------
describe('alerts.list() REST path — happy path', () => {
  it('returns success=true, source=rest_api, mapped alert', async () => {
    const data = {
      s: 'ok',
      r: [
        {
          alert_id: 1,
          symbol: 'AAPL',
          type: 'price',
          message: 'cross',
          active: true,
          condition: 'crossing',
          resolution: '1D',
          create_time: 1700000000,
          last_fire_time: null,
          expiration: null,
        },
      ],
    };
    const evaluateAsync = makeEvalAsync(data);

    const result = await core.list({ _deps: { evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.source, 'rest_api');
    assert.equal(result.alert_count, 1);
    assert.equal(result.alerts.length, 1);
    assert.equal(result.alerts[0].symbol, 'AAPL');
    assert.equal(result.alerts[0].alert_id, 1);
    assert.equal(result.alerts[0].condition, 'crossing');
    assert.equal(result.error, undefined);
  });
});

// ---------------------------------------------------------------------------
// 3. JSON-encoded symbol decoding
// ---------------------------------------------------------------------------
describe('alerts.list() REST path — JSON-encoded symbol', () => {
  it('decodes "={...}" symbol payloads', async () => {
    const data = {
      s: 'ok',
      r: [
        {
          alert_id: 7,
          symbol: '={"type":"symbol","symbol":"NASDAQ:TSLA"}',
          active: false,
        },
      ],
    };
    const evaluateAsync = makeEvalAsync(data);

    const result = await core.list({ _deps: { evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.alert_count, 1);
    assert.equal(result.alerts[0].symbol, 'NASDAQ:TSLA');
  });
});

// ---------------------------------------------------------------------------
// 4. data.s !== 'ok' → soft-failure shape
// ---------------------------------------------------------------------------
describe('alerts.list() REST path — non-ok status field', () => {
  it('returns soft-failure shape with empty alerts and an error', async () => {
    const data = { s: 'error', errmsg: 'session expired' };
    const evaluateAsync = makeEvalAsync(data);

    const result = await core.list({ _deps: { evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.source, 'rest_api');
    assert.equal(result.alert_count, 0);
    assert.deepEqual(result.alerts, []);
    assert.ok(result.error, 'should carry an error message');
  });
});

// ---------------------------------------------------------------------------
// 5. Non-2xx REST error (HTTP 403) → soft-failure shape (does NOT throw)
// ---------------------------------------------------------------------------
describe('alerts.list() REST path — HTTP 403 soft failure', () => {
  it('catches TvError(REST_HTTP) and returns soft-failure shape', async () => {
    const evaluateAsync = makeEvalAsync(null, { ok: false, status: 403 });

    const result = await core.list({ _deps: { evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.source, 'rest_api');
    assert.equal(result.alert_count, 0);
    assert.deepEqual(result.alerts, []);
    assert.ok(result.error, 'should carry the HTTP error message');
  });
});

// ---------------------------------------------------------------------------
// 6. Empty data.r=[] → alert_count=0
// ---------------------------------------------------------------------------
describe('alerts.list() REST path — empty alert list', () => {
  it('returns alert_count=0 and empty alerts array', async () => {
    const data = { s: 'ok', r: [] };
    const evaluateAsync = makeEvalAsync(data);

    const result = await core.list({ _deps: { evaluateAsync } });

    assert.equal(result.success, true);
    assert.equal(result.alert_count, 0);
    assert.deepEqual(result.alerts, []);
    assert.equal(result.error, undefined);
  });
});

/**
 * Offline DI-mock tests for the technicals core module (REST-from-Node).
 * No live chart required. A mock `fetch` is injected via _deps and returns a
 * scanner-shaped { totalCount, data:[{ s, d:[...] }] } payload.
 *
 * Run: node --test tests/technicals.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getTechnicals, detectScreener, ratingLabel } from '../src/core/technicals.js';
import { TvError } from '../src/core/TvError.js';

// Ensure REST is enabled for the default test groups (clear any inherited =0).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/**
 * Build a mock fetch returning the given scanner data. Captures the last call's
 * url + parsed body for assertions.
 */
function makeFetch(scannerData, { ok = true, status = 200 } = {}) {
  const fn = async (url, init) => {
    fn.lastUrl = url;
    fn.lastInit = init;
    fn.lastBody = init && init.body ? JSON.parse(init.body) : null;
    return { ok, status, json: async () => scannerData };
  };
  return fn;
}

/** Default scanner payload for NASDAQ:AMZN with the 3 default columns. */
function defaultScan(d = [-0.354, -0.8, 0.09]) {
  return { totalCount: 1, data: [{ s: 'NASDAQ:AMZN', d }] };
}

// ---------------------------------------------------------------------------
// detectScreener — prefix mapping
// ---------------------------------------------------------------------------
describe('detectScreener()', () => {
  it('NASDAQ → america, guessed=false', () => {
    assert.deepEqual(detectScreener('NASDAQ:AMZN'), { screener: 'america', guessed: false });
  });
  it('BINANCE → crypto, guessed=false', () => {
    assert.deepEqual(detectScreener('BINANCE:BTCUSDT'), { screener: 'crypto', guessed: false });
  });
  it('CME → futures, guessed=false', () => {
    assert.deepEqual(detectScreener('CME:ES1!'), { screener: 'futures', guessed: false });
  });
  it('unknown prefix → america, guessed=true', () => {
    assert.deepEqual(detectScreener('WEIRD:FOO'), { screener: 'america', guessed: true });
  });
  it('no colon (plain symbol) → america, guessed=true', () => {
    assert.deepEqual(detectScreener('AMZN'), { screener: 'america', guessed: true });
  });
});

// ---------------------------------------------------------------------------
// ratingLabel — boundary mapping
// ---------------------------------------------------------------------------
describe('ratingLabel()', () => {
  it('derives labels correctly across the ±1 range', () => {
    assert.equal(ratingLabel(0.9), 'Strong Buy');   // > 0.5
    assert.equal(ratingLabel(0.2), 'Buy');          // > 0.1
    assert.equal(ratingLabel(0.0), 'Neutral');      // -0.1..0.1
    assert.equal(ratingLabel(-0.3), 'Sell');        // -0.5..-0.1
    assert.equal(ratingLabel(-0.8), 'Strong Sell'); // < -0.5
    assert.equal(ratingLabel(null), 'N/A');
    assert.equal(ratingLabel(undefined), 'N/A');
  });
});

// ---------------------------------------------------------------------------
// getTechnicals — request construction
// ---------------------------------------------------------------------------
describe('getTechnicals() — request', () => {
  it('NASDAQ symbol → america screener, guessed=false, correct request body', async () => {
    const fetch = makeFetch(defaultScan());
    const out = await getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });

    assert.ok(fetch.lastUrl.includes('scanner.tradingview.com/america/scan'));
    assert.equal(fetch.lastInit.method, 'POST');
    assert.deepEqual(fetch.lastBody.symbols.tickers, ['NASDAQ:AMZN']);
    assert.deepEqual(fetch.lastBody.columns, ['Recommend.All', 'Recommend.MA', 'Recommend.Other']);
    assert.equal(out.screener, 'america');
    assert.equal(out.screener_guessed, false);
  });

  it('unknown prefix → screener_guessed:true in response', async () => {
    const fetch = makeFetch({ totalCount: 1, data: [{ s: 'WEIRD:FOO', d: [0.1, 0.2, 0.0] }] });
    const out = await getTechnicals({ symbol: 'WEIRD:FOO', _deps: { fetch } });
    assert.equal(out.screener, 'america');
    assert.equal(out.screener_guessed, true);
    assert.ok(fetch.lastUrl.includes('/america/scan'));
  });

  it('default columns are Recommend.All, Recommend.MA, Recommend.Other', async () => {
    const fetch = makeFetch(defaultScan());
    await getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.deepEqual(fetch.lastBody.columns, ['Recommend.All', 'Recommend.MA', 'Recommend.Other']);
  });

  it('custom columns are used in the request', async () => {
    const fetch = makeFetch({ totalCount: 1, data: [{ s: 'NASDAQ:AMZN', d: [10, 20] }] });
    await getTechnicals({ symbol: 'NASDAQ:AMZN', columns: ['RSI', 'MACD.macd'], _deps: { fetch } });
    assert.deepEqual(fetch.lastBody.columns, ['RSI', 'MACD.macd']);
  });

  it('interval 1W → columns carry |1W suffix in request body', async () => {
    const fetch = makeFetch(defaultScan());
    const out = await getTechnicals({ symbol: 'NASDAQ:AMZN', interval: '1W', _deps: { fetch } });
    assert.deepEqual(fetch.lastBody.columns, ['Recommend.All|1W', 'Recommend.MA|1W', 'Recommend.Other|1W']);
    assert.equal(out.interval, '1W');
    // recommend blocks resolve from the suffixed column names
    assert.equal(out.recommendation.value, -0.354);
    assert.equal(out.moving_averages.value, -0.8);
    assert.equal(out.oscillators.value, 0.09);
  });

  it('unmapped interval → no suffix (falls through INTERVAL_MAP), interval echoed raw', async () => {
    const fetch = makeFetch(defaultScan());
    const out = await getTechnicals({ symbol: 'NASDAQ:AMZN', interval: '3D', _deps: { fetch } });
    // '3D' is not in INTERVAL_MAP → suffix is null → bare column names
    assert.deepEqual(fetch.lastBody.columns, ['Recommend.All', 'Recommend.MA', 'Recommend.Other']);
    // recommend blocks still resolve from the unsuffixed columns
    assert.equal(out.recommendation.value, -0.354);
    assert.equal(out.moving_averages.value, -0.8);
    assert.equal(out.oscillators.value, 0.09);
    assert.equal(out.interval, '3D'); // echoed verbatim even though unmapped
  });
});

// ---------------------------------------------------------------------------
// getTechnicals — response shape
// ---------------------------------------------------------------------------
describe('getTechnicals() — response', () => {
  it('positional zip: raw has named keys matching column values', async () => {
    const fetch = makeFetch(defaultScan([-0.354, -0.8, 0.09]));
    const out = await getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.deepEqual(out.raw, {
      'Recommend.All': -0.354,
      'Recommend.MA': -0.8,
      'Recommend.Other': 0.09,
    });
  });

  it('recommendation/oscillators/moving_averages map to the right columns', async () => {
    const fetch = makeFetch(defaultScan([-0.354, -0.8, 0.09]));
    const out = await getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.equal(out.recommendation.value, -0.354); // Recommend.All
    assert.equal(out.moving_averages.value, -0.8);  // Recommend.MA
    assert.equal(out.oscillators.value, 0.09);      // Recommend.Other
  });

  it('recommendation.label matches ratingLabel(Recommend.All value)', async () => {
    const fetch = makeFetch(defaultScan([0.7, 0.6, 0.8]));
    const out = await getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.equal(out.recommendation.label, ratingLabel(0.7));
    assert.equal(out.recommendation.label, 'Strong Buy');
  });

  it('source: rest_api present in return', async () => {
    const fetch = makeFetch(defaultScan());
    const out = await getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.equal(out.source, 'rest_api');
  });
});

// ---------------------------------------------------------------------------
// getTechnicals — error handling
// ---------------------------------------------------------------------------
describe('getTechnicals() — errors', () => {
  it('symbol required → throws when missing', async () => {
    await assert.rejects(
      () => getTechnicals({ _deps: { fetch: makeFetch(defaultScan()) } }),
      /symbol is required/,
    );
  });

  it('column count mismatch → TvError(JS_EVAL)', async () => {
    // 3 columns requested but only 2 values returned
    const fetch = makeFetch({ totalCount: 1, data: [{ s: 'NASDAQ:AMZN', d: [-0.354, -0.8] }] });
    await assert.rejects(
      () => getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'JS_EVAL');
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  it('empty data[] → TvError(REST_HTTP, retryable:false)', async () => {
    const fetch = makeFetch({ totalCount: 0, data: [] });
    await assert.rejects(
      () => getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  it('HTTP 429 → TvError(REST_HTTP, retryable:true)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 429 });
    await assert.rejects(
      () => getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });

  it('HTTP 503 → TvError(REST_HTTP, retryable:true)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 503 });
    await assert.rejects(
      () => getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, true);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getTechnicals — TV_MCP_REST=0
// ---------------------------------------------------------------------------
describe('getTechnicals() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    const fetch = makeFetch(defaultScan());
    await assert.rejects(
      () => getTechnicals({ symbol: 'NASDAQ:AMZN', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

/**
 * Offline DI-mock tests for the financials core module (REST-from-Node).
 * No live chart required. fetch is injected via _deps; we assert URL/headers
 * and the returned flat data object.
 *
 * Run: node --test tests/financials.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchFinancials,
  fetchForecast,
  recommendationLabel,
} from '../src/core/financials.js';
import { TvError } from '../src/core/TvError.js';

// Ensure REST is enabled for the default test groups (clear any inherited =0).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/** A fetch mock that records the last (url, opts) and returns `payload`. */
function makeFetch(payload, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    return { ok, status, json: async () => payload };
  };
  fn.calls = calls;
  return fn;
}

const FIN_PAYLOAD = { total_revenue: 716924000000, net_income: 59248000000, price_earnings_ttm: 27.808 };
const FCAST_PAYLOAD = { price_target_average: 316.56, recommendation_mark: 1.11, recommendation_buy: 50 };

// ---------------------------------------------------------------------------
// fetchFinancials
// ---------------------------------------------------------------------------
describe('fetchFinancials()', () => {
  it('symbol required: missing symbol throws', async () => {
    await assert.rejects(
      () => fetchFinancials({ _deps: { fetch: makeFetch(FIN_PAYLOAD) } }),
      /symbol is required/,
    );
  });

  it('builds correct URL (symbol + default fields in query string)', async () => {
    const fetch = makeFetch(FIN_PAYLOAD);
    await fetchFinancials({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    const { url } = fetch.calls[0];
    assert.ok(url.startsWith('https://scanner.tradingview.com/symbol?'), 'scanner symbol endpoint');
    assert.match(url, /symbol=NASDAQ%3AAMZN/, 'symbol url-encoded');
    assert.match(url, /fields=/, 'fields present');
    assert.match(url, /total_revenue/, 'default field total_revenue present');
    assert.match(url, /price_earnings_ttm/, 'default field price_earnings_ttm present');
  });

  it('sends User-Agent and Origin headers', async () => {
    const fetch = makeFetch(FIN_PAYLOAD);
    await fetchFinancials({ symbol: 'AAPL', _deps: { fetch } });
    const { opts } = fetch.calls[0];
    assert.equal(opts.headers['User-Agent'], 'Mozilla/5.0');
    assert.equal(opts.headers.Origin, 'https://www.tradingview.com');
  });

  it('returns flat data object on success with source rest_api', async () => {
    const fetch = makeFetch(FIN_PAYLOAD);
    const out = await fetchFinancials({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.equal(out.success, true);
    assert.equal(out.symbol, 'NASDAQ:AMZN');
    assert.equal(out.source, 'rest_api');
    assert.deepEqual(out.data, FIN_PAYLOAD);
    assert.equal(out.data.total_revenue, 716924000000);
  });

  it('custom fields override defaults', async () => {
    const fetch = makeFetch(FIN_PAYLOAD);
    await fetchFinancials({ symbol: 'AAPL', fields: 'total_revenue,net_income', _deps: { fetch } });
    const { url } = fetch.calls[0];
    assert.match(url, /fields=total_revenue%2Cnet_income/, 'csv custom fields encoded');
    assert.doesNotMatch(url, /ebitda/, 'default field dropped when overridden');
  });

  it('custom fields as array override defaults', async () => {
    const fetch = makeFetch(FIN_PAYLOAD);
    await fetchFinancials({ symbol: 'AAPL', fields: ['ebitda', 'ebit'], _deps: { fetch } });
    const { url } = fetch.calls[0];
    assert.match(url, /fields=ebitda%2Cebit/, 'array custom fields joined + encoded');
  });

  it('empty fields string uses all default financial fields', async () => {
    const fetch = makeFetch(FIN_PAYLOAD);
    await fetchFinancials({ symbol: 'AAPL', fields: '', _deps: { fetch } });
    const { url } = fetch.calls[0];
    assert.match(url, /total_revenue/);
    assert.match(url, /earnings_per_share_basic_ttm/);
  });

  it('empty response object → non-retryable TvError(REST_HTTP)', async () => {
    const fetch = makeFetch({});
    await assert.rejects(
      () => fetchFinancials({ symbol: 'AAPL', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  it('null response → non-retryable TvError(REST_HTTP)', async () => {
    const fetch = makeFetch(null);
    await assert.rejects(
      () => fetchFinancials({ symbol: 'AAPL', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  it('HTTP 503 → TvError(REST_HTTP, retryable)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 503 });
    await assert.rejects(
      () => fetchFinancials({ symbol: 'AAPL', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, true);
        assert.equal(err.meta?.status, 503);
        return true;
      },
    );
  });

  it('HTTP 429 → TvError(REST_HTTP, retryable)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 429 });
    await assert.rejects(
      () => fetchFinancials({ symbol: 'AAPL', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, true);
        assert.equal(err.meta?.status, 429);
        return true;
      },
    );
  });
});

describe('fetchFinancials() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => fetchFinancials({ symbol: 'AAPL', _deps: { fetch: makeFetch(FIN_PAYLOAD) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// fetchForecast
// ---------------------------------------------------------------------------
describe('fetchForecast()', () => {
  it('symbol required: missing symbol throws', async () => {
    await assert.rejects(
      () => fetchForecast({ _deps: { fetch: makeFetch(FCAST_PAYLOAD) } }),
      /symbol is required/,
    );
  });

  it('builds correct URL (symbol + default forecast fields)', async () => {
    const fetch = makeFetch(FCAST_PAYLOAD);
    await fetchForecast({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    const { url } = fetch.calls[0];
    assert.ok(url.startsWith('https://scanner.tradingview.com/symbol?'));
    assert.match(url, /symbol=NASDAQ%3AAMZN/);
    assert.match(url, /price_target_average/, 'default forecast field present');
    assert.match(url, /recommendation_mark/, 'default forecast field present');
  });

  it('sends User-Agent and Origin headers', async () => {
    const fetch = makeFetch(FCAST_PAYLOAD);
    await fetchForecast({ symbol: 'AAPL', _deps: { fetch } });
    const { opts } = fetch.calls[0];
    assert.equal(opts.headers['User-Agent'], 'Mozilla/5.0');
    assert.equal(opts.headers.Origin, 'https://www.tradingview.com');
  });

  it('returns flat data object on success with source rest_api', async () => {
    const fetch = makeFetch(FCAST_PAYLOAD);
    const out = await fetchForecast({ symbol: 'NASDAQ:AMZN', _deps: { fetch } });
    assert.equal(out.success, true);
    assert.equal(out.symbol, 'NASDAQ:AMZN');
    assert.equal(out.source, 'rest_api');
    assert.equal(out.data.price_target_average, 316.56);
  });

  it('custom fields override defaults', async () => {
    const fetch = makeFetch(FCAST_PAYLOAD);
    await fetchForecast({ symbol: 'AAPL', fields: 'price_target_high,price_target_low', _deps: { fetch } });
    const { url } = fetch.calls[0];
    assert.match(url, /fields=price_target_high%2Cprice_target_low/);
    assert.doesNotMatch(url, /recommendation_mark/, 'default field dropped when overridden');
  });

  it('empty fields string uses all default forecast fields', async () => {
    const fetch = makeFetch(FCAST_PAYLOAD);
    await fetchForecast({ symbol: 'AAPL', fields: '', _deps: { fetch } });
    const { url } = fetch.calls[0];
    assert.match(url, /price_target_average/);
    assert.match(url, /earnings_release_date/);
  });

  it('empty response object → non-retryable TvError(REST_HTTP)', async () => {
    const fetch = makeFetch({});
    await assert.rejects(
      () => fetchForecast({ symbol: 'AAPL', _deps: { fetch } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.retryable, false);
        return true;
      },
    );
  });

  it('HTTP 503 → TvError(REST_HTTP, retryable)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 503 });
    await assert.rejects(
      () => fetchForecast({ symbol: 'AAPL', _deps: { fetch } }),
      (err) => { assert.equal(err.code, 'REST_HTTP'); assert.equal(err.retryable, true); return true; },
    );
  });

  it('HTTP 429 → TvError(REST_HTTP, retryable)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 429 });
    await assert.rejects(
      () => fetchForecast({ symbol: 'AAPL', _deps: { fetch } }),
      (err) => { assert.equal(err.code, 'REST_HTTP'); assert.equal(err.retryable, true); return true; },
    );
  });

  it('derives recommendation_label from recommendation_mark (1.1 → Strong Buy)', async () => {
    const fetch = makeFetch({ recommendation_mark: 1.1, price_target_average: 100 });
    const out = await fetchForecast({ symbol: 'AAPL', _deps: { fetch } });
    assert.equal(out.recommendation_label, 'Strong Buy');
    assert.equal(out.data.recommendation_label, 'Strong Buy', 'label also embedded in data');
  });

  it('recommendation_label thresholds: 2.0→Buy, 3.0→Hold, 4.0→Sell, 5.0→Strong Sell', async () => {
    const cases = [
      [2.0, 'Buy'],
      [3.0, 'Hold'],
      [4.0, 'Sell'],
      [5.0, 'Strong Sell'],
    ];
    for (const [mark, label] of cases) {
      const fetch = makeFetch({ recommendation_mark: mark, price_target_average: 1 });
      const out = await fetchForecast({ symbol: 'AAPL', _deps: { fetch } });
      assert.equal(out.recommendation_label, label, `mark ${mark} → ${label}`);
    }
  });

  it('missing recommendation_mark → recommendation_label null', async () => {
    const fetch = makeFetch({ price_target_average: 100 });
    const out = await fetchForecast({ symbol: 'AAPL', _deps: { fetch } });
    assert.equal(out.recommendation_label, null);
  });
});

describe('fetchForecast() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => fetchForecast({ symbol: 'AAPL', _deps: { fetch: makeFetch(FCAST_PAYLOAD) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// recommendationLabel (pure)
// ---------------------------------------------------------------------------
describe('recommendationLabel()', () => {
  it('boundary values map correctly', () => {
    assert.equal(recommendationLabel(1.0), 'Strong Buy');
    assert.equal(recommendationLabel(1.5), 'Strong Buy');
    assert.equal(recommendationLabel(1.51), 'Buy');
    assert.equal(recommendationLabel(2.5), 'Buy');
    assert.equal(recommendationLabel(2.51), 'Hold');
    assert.equal(recommendationLabel(3.5), 'Hold');
    assert.equal(recommendationLabel(3.51), 'Sell');
    assert.equal(recommendationLabel(4.5), 'Sell');
    assert.equal(recommendationLabel(4.51), 'Strong Sell');
    assert.equal(recommendationLabel(5.0), 'Strong Sell');
  });

  it('non-finite / missing → null', () => {
    assert.equal(recommendationLabel(undefined), null);
    assert.equal(recommendationLabel(null), null);
    assert.equal(recommendationLabel(NaN), null);
    assert.equal(recommendationLabel('abc'), null);
  });
});

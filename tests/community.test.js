/**
 * Offline DI-mock tests for the community core module (REST-first, public).
 * No live chart required. A mock `fetch` is injected via _deps; results are
 * asserted on the constructed URL and the mapped return shape.
 *
 * Run: node --test tests/community.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getIdeas, getMinds, getScripts, walkAst } from '../src/core/community.js';
import { TvError } from '../src/core/TvError.js';

// Ensure REST is enabled for the default test groups (clear any inherited =0).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/** Build a mock fetch that records the URL and returns `body` as JSON. */
function makeFetch(body, { ok = true, status = 200 } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return { ok, status, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

// ---------------------------------------------------------------------------
// getIdeas
// ---------------------------------------------------------------------------
describe('getIdeas()', () => {
  const ideasBody = {
    count: 100,
    page_size: 20,
    page_count: 5,
    next: 'https://www.tradingview.com/api/v1/ideas/?page=3',
    results: [
      { id: 1, name: 'Test Idea', description: 'desc', created_at: '2026-01-01T00:00:00Z', chart_url: 'https://chart', is_hot: false, comments_count: 2, views_count: 100, likes_count: 5, user: { username: 'trader1' } },
    ],
  };

  it('URL includes encoded symbol, page, sort', async () => {
    const fetch = makeFetch(ideasBody);
    await getIdeas({ symbol: 'NASDAQ:AMZN', page: 2, sort: 'popular', _deps: { fetch } });
    const url = fetch.calls[0].url;
    assert.ok(url.startsWith('https://www.tradingview.com/api/v1/ideas/'), 'correct endpoint');
    assert.ok(url.includes('symbol=NASDAQ%3AAMZN'), 'symbol encoded');
    assert.ok(url.includes('page=2'), 'page param');
    assert.ok(url.includes('sort=popular'), 'sort param');
  });

  it('defaults: page=1, sort=recent', async () => {
    const fetch = makeFetch(ideasBody);
    const out = await getIdeas({ symbol: 'AMZN', _deps: { fetch } });
    const url = fetch.calls[0].url;
    assert.ok(url.includes('page=1'));
    assert.ok(url.includes('sort=recent'));
    assert.equal(out.page, 1);
  });

  it('invalid sort falls back to recent', async () => {
    const fetch = makeFetch(ideasBody);
    await getIdeas({ symbol: 'AMZN', sort: 'bogus', _deps: { fetch } });
    assert.ok(fetch.calls[0].url.includes('sort=recent'));
  });

  it('results mapped: name→title, counts→short keys, user.username→author', async () => {
    const fetch = makeFetch(ideasBody);
    const out = await getIdeas({ symbol: 'AMZN', _deps: { fetch } });
    assert.equal(out.count, 1);
    assert.equal(out.total, 100);
    assert.equal(out.page_size, 20);
    assert.equal(out.page_count, 5);
    const r = out.results[0];
    assert.equal(r.id, 1);
    assert.equal(r.title, 'Test Idea');
    assert.equal(r.description, 'desc');
    assert.equal(r.created_at, '2026-01-01T00:00:00Z');
    assert.equal(r.chart_url, 'https://chart');
    assert.equal(r.is_hot, false);
    assert.equal(r.comments, 2);
    assert.equal(r.views, 100);
    assert.equal(r.likes, 5);
    assert.equal(r.author, 'trader1');
  });

  it('has_more=true when data.next truthy', async () => {
    const out = await getIdeas({ symbol: 'AMZN', _deps: { fetch: makeFetch(ideasBody) } });
    assert.equal(out.has_more, true);
  });

  it('has_more=false when data.next null', async () => {
    const body = { ...ideasBody, next: null };
    const out = await getIdeas({ symbol: 'AMZN', _deps: { fetch: makeFetch(body) } });
    assert.equal(out.has_more, false);
  });

  it('empty results → empty array, not error', async () => {
    const out = await getIdeas({ symbol: 'AMZN', _deps: { fetch: makeFetch({ count: 0, results: [] }) } });
    assert.equal(out.success, true);
    assert.equal(out.count, 0);
    assert.deepEqual(out.results, []);
  });

  it('missing results field → empty array', async () => {
    const out = await getIdeas({ symbol: 'AMZN', _deps: { fetch: makeFetch({ count: 0 }) } });
    assert.deepEqual(out.results, []);
  });

  it('source: rest_api present', async () => {
    const out = await getIdeas({ symbol: 'AMZN', _deps: { fetch: makeFetch(ideasBody) } });
    assert.equal(out.source, 'rest_api');
  });

  it('symbol required: missing throws', async () => {
    await assert.rejects(() => getIdeas({ _deps: { fetch: makeFetch(ideasBody) } }), /symbol is required/);
  });

  it('HTTP 429 → retryable TvError(REST_HTTP)', async () => {
    const fetch = makeFetch(null, { ok: false, status: 429 });
    await assert.rejects(
      () => getIdeas({ symbol: 'AMZN', _deps: { fetch } }),
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

describe('getIdeas() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => getIdeas({ symbol: 'AMZN', _deps: { fetch: makeFetch({ results: [] }) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getMinds
// ---------------------------------------------------------------------------
describe('getMinds()', () => {
  const mindsBody = {
    results: [
      {
        uid: 'post-xyz',
        text_ast: { type: 'doc', children: [{ type: 'text', text: 'AMZN looks bullish' }] },
        author: { username: 'trader1' },
        created: '2026-01-15T10:30:00Z',
        total_comments: 3,
      },
    ],
    next: 'https://www.tradingview.com/api/v2/minds/?symbol=NASDAQ%3AAMZN&c=CURSOR123',
    prev: null,
  };

  it('URL includes encoded symbol and limit', async () => {
    const fetch = makeFetch(mindsBody);
    await getMinds({ symbol: 'NASDAQ:AMZN', limit: 10, _deps: { fetch } });
    const url = fetch.calls[0].url;
    assert.ok(url.startsWith('https://www.tradingview.com/api/v2/minds/'));
    assert.ok(url.includes('symbol=NASDAQ%3AAMZN'));
    assert.ok(url.includes('limit=10'));
  });

  it('cursor appended as c= when provided', async () => {
    const fetch = makeFetch(mindsBody);
    await getMinds({ symbol: 'AMZN', cursor: 'abc123', _deps: { fetch } });
    assert.ok(fetch.calls[0].url.includes('c=abc123'), 'cursor in URL');
  });

  it('cursor omitted → no c= param', async () => {
    const fetch = makeFetch(mindsBody);
    await getMinds({ symbol: 'AMZN', _deps: { fetch } });
    assert.ok(!fetch.calls[0].url.includes('c='), 'no cursor param');
  });

  it('text_ast walked: doc/text → plain text', async () => {
    const out = await getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch(mindsBody) } });
    assert.equal(out.results[0].text, 'AMZN looks bullish');
  });

  it('text_ast nested children concatenated', async () => {
    const ast = { children: [{ children: [{ text: 'A' }, { text: 'B' }] }] };
    assert.equal(walkAst(ast), 'AB');
  });

  it('text_ast walker handles string nodes and content arrays', async () => {
    assert.equal(walkAst('plain'), 'plain');
    assert.equal(walkAst({ content: [{ text: 'X' }, { text: 'Y' }] }), 'XY');
    assert.equal(walkAst(null), '');
    assert.equal(walkAst({}), '');
  });

  it('result mapping: uid→id, author.username, total_comments→comments', async () => {
    const out = await getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch(mindsBody) } });
    const r = out.results[0];
    assert.equal(r.id, 'post-xyz');
    assert.equal(r.author, 'trader1');
    assert.equal(r.created, '2026-01-15T10:30:00Z');
    assert.equal(r.comments, 3);
  });

  it('next_cursor extracted from next URL', async () => {
    const out = await getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch(mindsBody) } });
    assert.equal(out.next_cursor, 'CURSOR123');
    assert.equal(out.has_more, true);
  });

  it('null next → next_cursor null, has_more false', async () => {
    const body = { results: [], next: null };
    const out = await getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch(body) } });
    assert.equal(out.next_cursor, null);
    assert.equal(out.has_more, false);
  });

  it('malformed next URL → next_cursor null (no throw)', async () => {
    const body = { results: [], next: 'not a url' };
    const out = await getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch(body) } });
    assert.equal(out.next_cursor, null);
  });

  it('empty results → empty array', async () => {
    const out = await getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch({ results: [] }) } });
    assert.deepEqual(out.results, []);
    assert.equal(out.count, 0);
  });

  it('limit clamping: 999→50, 0→1, -5→1', async () => {
    const f999 = makeFetch(mindsBody);
    await getMinds({ symbol: 'AMZN', limit: 999, _deps: { fetch: f999 } });
    assert.ok(f999.calls[0].url.includes('limit=50'), '999 clamps to 50');

    const f0 = makeFetch(mindsBody);
    await getMinds({ symbol: 'AMZN', limit: 0, _deps: { fetch: f0 } });
    assert.ok(f0.calls[0].url.includes('limit=1'), '0 clamps to 1');

    const fNeg = makeFetch(mindsBody);
    await getMinds({ symbol: 'AMZN', limit: -5, _deps: { fetch: fNeg } });
    assert.ok(fNeg.calls[0].url.includes('limit=1'), '-5 clamps to 1');
  });

  it('source: rest_api present', async () => {
    const out = await getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch(mindsBody) } });
    assert.equal(out.source, 'rest_api');
  });

  it('symbol required: missing throws', async () => {
    await assert.rejects(() => getMinds({ _deps: { fetch: makeFetch(mindsBody) } }), /symbol is required/);
  });
});

describe('getMinds() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => getMinds({ symbol: 'AMZN', _deps: { fetch: makeFetch({ results: [] }) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getScripts
// ---------------------------------------------------------------------------
describe('getScripts()', () => {
  const scriptsBody = {
    count: 500,
    next: 'https://www.tradingview.com/api/v1/scripts/?page=2',
    results: [
      { id: 'script-abc', name: 'AMZN RSI Strategy', description: 'rsi', created_at: '2026-01-01T00:00:00Z', views_count: 500, likes_count: 20, user: { username: 'pinemaster' } },
    ],
  };

  it('URL includes encoded symbol and page', async () => {
    const fetch = makeFetch(scriptsBody);
    await getScripts({ symbol: 'NASDAQ:AMZN', page: 3, _deps: { fetch } });
    const url = fetch.calls[0].url;
    assert.ok(url.startsWith('https://www.tradingview.com/api/v1/scripts/'));
    assert.ok(url.includes('symbol=NASDAQ%3AAMZN'));
    assert.ok(url.includes('page=3'));
  });

  it('with query → q param included', async () => {
    const fetch = makeFetch(scriptsBody);
    await getScripts({ symbol: 'AMZN', query: 'rsi strategy', _deps: { fetch } });
    const url = fetch.calls[0].url;
    assert.ok(/[?&]q=rsi/.test(url) || url.includes('q=rsi'), 'q param present');
  });

  it('no query → no q param', async () => {
    const fetch = makeFetch(scriptsBody);
    await getScripts({ symbol: 'AMZN', _deps: { fetch } });
    assert.ok(!fetch.calls[0].url.includes('q='), 'no q param');
  });

  it('results mapped: name→title, user.username→author', async () => {
    const out = await getScripts({ symbol: 'AMZN', _deps: { fetch: makeFetch(scriptsBody) } });
    assert.equal(out.count, 1);
    assert.equal(out.total, 500);
    const r = out.results[0];
    assert.equal(r.id, 'script-abc');
    assert.equal(r.title, 'AMZN RSI Strategy');
    assert.equal(r.description, 'rsi');
    assert.equal(r.views, 500);
    assert.equal(r.likes, 20);
    assert.equal(r.author, 'pinemaster');
  });

  it('empty results → empty array', async () => {
    const out = await getScripts({ symbol: 'AMZN', _deps: { fetch: makeFetch({ count: 0, results: [] }) } });
    assert.equal(out.success, true);
    assert.deepEqual(out.results, []);
  });

  it('source: rest_api present', async () => {
    const out = await getScripts({ symbol: 'AMZN', _deps: { fetch: makeFetch(scriptsBody) } });
    assert.equal(out.source, 'rest_api');
  });

  it('symbol required: missing throws', async () => {
    await assert.rejects(() => getScripts({ _deps: { fetch: makeFetch(scriptsBody) } }), /symbol is required/);
  });
});

describe('getScripts() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => getScripts({ symbol: 'AMZN', _deps: { fetch: makeFetch({ results: [] }) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

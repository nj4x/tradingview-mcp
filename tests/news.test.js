/**
 * Offline DI-mock tests for the news core module (REST-migrated).
 * No live chart required. Uses the envelope-mock pattern: the renderer's
 * evaluateAsync returns a { __ok, status, data } envelope that
 * restFromRenderer unwraps; all post-processing happens in Node.
 *
 * Run: node --test tests/news.test.js
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getHeadlines, getStory } from '../src/core/news.js';
import { TvError } from '../src/core/TvError.js';

// Ensure REST is enabled for the default test groups (clear any inherited =0).
let _prevRestFlag;
before(() => { _prevRestFlag = process.env.TV_MCP_REST; delete process.env.TV_MCP_REST; });
after(() => { if (_prevRestFlag === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prevRestFlag; });

/** Build an evaluateAsync that returns a REST envelope wrapping responseData. */
function makeNewsEvalAsync(responseData, { ok = true, status = 200 } = {}) {
  return async (_expr) => ({ __ok: ok, status, data: responseData });
}

/** Build an evaluate that returns the pro_name string (for the symbol-omitted path). */
function makeProNameEval(proName) {
  const calls = [];
  const fn = async (expr) => { calls.push(expr); return proName; };
  fn.calls = calls;
  return fn;
}

const noEvaluate = async () => { throw new Error('evaluate() should not be called'); };

// ---------------------------------------------------------------------------
// getHeadlines
// ---------------------------------------------------------------------------
describe('getHeadlines()', () => {
  it('symbol provided → single evaluateAsync call, correct results and count', async () => {
    let asyncCalls = 0;
    const evaluateAsync = async (_expr) => {
      asyncCalls++;
      return {
        __ok: true,
        status: 200,
        data: {
          items: [
            { id: 'a', title: 'First', provider: { name: 'Reuters' }, published: 100, urgency: 1, source: 'reuters', relatedSymbols: [{ symbol: 'NASDAQ:AMZN' }] },
            { id: 'b', title: 'Second', provider: 'Dow Jones', published: 200, urgency: 2, source: 'dj' },
          ],
        },
      };
    };

    const out = await getHeadlines({ symbol: 'NASDAQ:AMZN', _deps: { evaluate: noEvaluate, evaluateAsync } });

    assert.equal(asyncCalls, 1, 'exactly one REST fetch');
    assert.equal(out.success, true);
    assert.equal(out.symbol, 'NASDAQ:AMZN');
    assert.equal(out.count, 2);
    assert.equal(out.results[0].id, 'a');
    assert.equal(out.results[0].title, 'First');
    assert.equal(out.results[0].provider, 'Reuters', 'provider.name flattened');
    assert.equal(out.results[1].provider, 'Dow Jones', 'string provider passthrough');
    assert.deepEqual(out.results[0].relatedSymbols, [{ symbol: 'NASDAQ:AMZN' }]);
    assert.deepEqual(out.results[1].relatedSymbols, [], 'missing relatedSymbols → []');
  });

  it('symbol omitted → evaluate resolves pro_name + evaluateAsync fetches REST data', async () => {
    const evaluate = makeProNameEval('NASDAQ:TSLA');
    const evaluateAsync = makeNewsEvalAsync({ items: [{ id: 'z', title: 'T' }] });

    const out = await getHeadlines({ _deps: { evaluate, evaluateAsync } });

    assert.equal(evaluate.calls.length, 1, 'evaluate called once for pro_name');
    assert.match(evaluate.calls[0], /symbolExt\(\)\.pro_name/);
    assert.equal(out.symbol, 'NASDAQ:TSLA');
    assert.equal(out.count, 1);
    assert.equal(out.results[0].id, 'z');
  });

  it('clamps limit: 999→50, 0→1, -5→1', async () => {
    const manyItems = Array.from({ length: 60 }, (_, i) => ({ id: String(i), title: `t${i}` }));

    const out999 = await getHeadlines({ symbol: 's', limit: 999, _deps: { evaluate: noEvaluate, evaluateAsync: makeNewsEvalAsync({ items: manyItems }) } });
    assert.equal(out999.count, 50, '999 clamps to 50');

    const out0 = await getHeadlines({ symbol: 's', limit: 0, _deps: { evaluate: noEvaluate, evaluateAsync: makeNewsEvalAsync({ items: manyItems }) } });
    assert.equal(out0.count, 1, '0 clamps to 1');

    const outNeg = await getHeadlines({ symbol: 's', limit: -5, _deps: { evaluate: noEvaluate, evaluateAsync: makeNewsEvalAsync({ items: manyItems }) } });
    assert.equal(outNeg.count, 1, '-5 clamps to 1');
  });

  it('renderer __error → throws Error', async () => {
    const evaluateAsync = async (_expr) => ({ __error: 'boom from renderer' });
    await assert.rejects(
      () => getHeadlines({ symbol: 's', _deps: { evaluate: noEvaluate, evaluateAsync } }),
      /boom from renderer/,
    );
  });

  it('non-2xx → throws TvError(REST_HTTP)', async () => {
    const evaluateAsync = makeNewsEvalAsync(null, { ok: false, status: 503 });
    await assert.rejects(
      () => getHeadlines({ symbol: 's', _deps: { evaluate: noEvaluate, evaluateAsync } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.meta?.status, 503);
        return true;
      },
    );
  });

  it('source: rest_api present in return', async () => {
    const out = await getHeadlines({ symbol: 's', _deps: { evaluate: noEvaluate, evaluateAsync: makeNewsEvalAsync({ items: [] }) } });
    assert.equal(out.source, 'rest_api');
  });
});

// ---------------------------------------------------------------------------
// getHeadlines — TV_MCP_REST=0
// ---------------------------------------------------------------------------
describe('getHeadlines() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    const evaluateAsync = makeNewsEvalAsync({ items: [] });
    await assert.rejects(
      () => getHeadlines({ symbol: 's', _deps: { evaluate: noEvaluate, evaluateAsync } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getStory
// ---------------------------------------------------------------------------
describe('getStory()', () => {
  it('id required: missing id throws', async () => {
    await assert.rejects(
      () => getStory({ _deps: { evaluateAsync: makeNewsEvalAsync({}) } }),
      /id is required/,
    );
  });

  it('id required: whitespace-only id throws', async () => {
    await assert.rejects(
      () => getStory({ id: '   ', _deps: { evaluateAsync: makeNewsEvalAsync({}) } }),
      /id is required/,
    );
  });

  it('returns source as article field (not clobbered), title, body assembled from flat()', async () => {
    const storyData = {
      title: 'Big News',
      provider: { name: 'Reuters' },
      source: 'Reuters Wire',
      published: 12345,
      link: 'https://example.com/a',
      shortDescription: 'A short blurb',
      content: [
        'Hello ',
        { content: ['world', { content: '!' }] },
        ['  ', 'tail'],
      ],
    };
    const out = await getStory({ id: 'story-1', _deps: { evaluateAsync: makeNewsEvalAsync(storyData) } });

    assert.equal(out.success, true);
    assert.equal(out.title, 'Big News');
    assert.equal(out.provider, 'Reuters', 'provider.name flattened');
    assert.equal(out.source, 'Reuters Wire', 'article source preserved, not rest_api');
    assert.notEqual(out.source, 'rest_api');
    assert.equal(out.published, 12345);
    assert.equal(out.link, 'https://example.com/a');
    assert.equal(out.shortDescription, 'A short blurb');
    assert.equal(out.body, 'Hello world!  tail', 'nested content tree flattened');
  });

  it('uses storyPath as link fallback and empty body when no content', async () => {
    const storyData = { title: 'T', source: 'Wire', storyPath: '/news/x' };
    const out = await getStory({ id: 'story-2', _deps: { evaluateAsync: makeNewsEvalAsync(storyData) } });
    assert.equal(out.link, '/news/x');
    assert.equal(out.shortDescription, '');
    assert.equal(out.body, '');
  });

  it('non-2xx → throws TvError(REST_HTTP)', async () => {
    const evaluateAsync = makeNewsEvalAsync(null, { ok: false, status: 404 });
    await assert.rejects(
      () => getStory({ id: 'story-x', _deps: { evaluateAsync } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_HTTP');
        assert.equal(err.meta?.status, 404);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// getStory — TV_MCP_REST=0
// ---------------------------------------------------------------------------
describe('getStory() — REST disabled', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; process.env.TV_MCP_REST = '0'; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED)', async () => {
    await assert.rejects(
      () => getStory({ id: 'story-1', _deps: { evaluateAsync: makeNewsEvalAsync({ title: 't' }) } }),
      (err) => {
        assert.ok(err instanceof TvError);
        assert.equal(err.code, 'REST_DISABLED');
        return true;
      },
    );
  });
});

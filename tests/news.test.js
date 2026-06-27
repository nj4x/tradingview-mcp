/**
 * Offline DI-mock tests for the news core module. No live chart required.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getHeadlines, getStory } from '../src/core/news.js';

function mockEval(returnValue) {
  const calls = [];
  const fn = async (expr) => { calls.push(expr); return returnValue; };
  fn.calls = calls;
  return fn;
}

const HEADLINES_URL = 'https://news-headlines.tradingview.com/v2/view/headlines/symbol';
const STORY_URL = 'https://news-headlines.tradingview.com/v2/story';

describe('getHeadlines()', () => {
  it('derives pro_name from symbolExt() when symbol omitted', async () => {
    const evaluateAsync = mockEval({ symbol: 'NASDAQ:AMZN', results: [] });
    await getHeadlines({ _deps: { evaluateAsync } });
    const expr = evaluateAsync.calls[0];
    assert.match(expr, /symbolExt\(\)\.pro_name/);
    assert.match(expr, /credentials: 'include'/);
    assert.ok(expr.includes(HEADLINES_URL));
  });

  it('escapes a provided symbol and never interpolates raw', async () => {
    const evaluateAsync = mockEval({ symbol: 'x', results: [] });
    const evil = '"]});evil(';
    await getHeadlines({ symbol: evil, _deps: { evaluateAsync } });
    const expr = evaluateAsync.calls[0];
    assert.ok(expr.includes(JSON.stringify(evil)));
    assert.ok(!expr.includes(`= ${evil};`));
    assert.ok(!expr.includes('symbolExt().pro_name'));
  });

  it('maps items and reports count', async () => {
    const evaluateAsync = mockEval({
      symbol: 'NASDAQ:AMZN',
      results: [{ id: 'x', title: 't' }, { id: 'y', title: 'u' }],
    });
    const out = await getHeadlines({ _deps: { evaluateAsync } });
    assert.equal(out.success, true);
    assert.equal(out.symbol, 'NASDAQ:AMZN');
    assert.equal(out.count, 2);
    assert.deepEqual(out.results[0], { id: 'x', title: 't' });
  });

  it('clamps limit above 50 down to 50', async () => {
    const evaluateAsync = mockEval({ symbol: 's', results: [] });
    await getHeadlines({ limit: 999, _deps: { evaluateAsync } });
    assert.match(evaluateAsync.calls[0], /\.slice\(0, 50\)/);
  });

  it('clamps limit of 0 up to 1', async () => {
    const evaluateAsync = mockEval({ symbol: 's', results: [] });
    await getHeadlines({ limit: 0, _deps: { evaluateAsync } });
    assert.match(evaluateAsync.calls[0], /\.slice\(0, 1\)/);
  });

  it('clamps negative limit up to 1', async () => {
    const evaluateAsync = mockEval({ symbol: 's', results: [] });
    await getHeadlines({ limit: -5, _deps: { evaluateAsync } });
    assert.match(evaluateAsync.calls[0], /\.slice\(0, 1\)/);
  });

  it('throws when the renderer returns __error', async () => {
    const evaluateAsync = mockEval({ __error: 'boom' });
    await assert.rejects(() => getHeadlines({ _deps: { evaluateAsync } }), /boom/);
  });
});

describe('getStory()', () => {
  it('throws when id is missing', async () => {
    const evaluateAsync = mockEval({});
    await assert.rejects(() => getStory({ _deps: { evaluateAsync } }), /Story id required/);
  });

  it('throws when id is empty/whitespace', async () => {
    const evaluateAsync = mockEval({});
    await assert.rejects(() => getStory({ id: '   ', _deps: { evaluateAsync } }), /Story id required/);
  });

  it('escapes id, includes flatten fn, story URL, and credentials', async () => {
    const evaluateAsync = mockEval({ title: 't', body: 'b' });
    const evil = '"]});evil(';
    const out = await getStory({ id: evil, _deps: { evaluateAsync } });
    const expr = evaluateAsync.calls[0];
    assert.ok(expr.includes(JSON.stringify(evil)));
    assert.ok(expr.includes(STORY_URL));
    assert.match(expr, /credentials: 'include'/);
    assert.match(expr, /function flat\(node\)/);
    assert.match(expr, /node\.children\.map\(flat\)/);
    assert.equal(out.success, true);
    assert.equal(out.title, 't');
    assert.equal(out.body, 'b');
  });

  it('throws when the renderer returns __error', async () => {
    const evaluateAsync = mockEval({ __error: 'kaboom' });
    await assert.rejects(() => getStory({ id: 'abc', _deps: { evaluateAsync } }), /kaboom/);
  });
});

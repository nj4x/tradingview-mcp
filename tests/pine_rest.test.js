import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { listScripts } from '../src/core/pine.js';
import { TvError } from '../src/core/TvError.js';

function makeEvalAsync(data, { ok = true, status = 200 } = {}) {
  return async (_expr) => ({ __ok: ok, status, data });
}

describe('listScripts() — REST migration', () => {
  let _prev;
  before(() => { _prev = process.env.TV_MCP_REST; });
  after(() => { if (_prev === undefined) delete process.env.TV_MCP_REST; else process.env.TV_MCP_REST = _prev; });

  it('returns mapped scripts with source:rest_api', async () => {
    delete process.env.TV_MCP_REST;
    const evaluateAsync = makeEvalAsync([
      { scriptIdPart: 'PUB;abc', scriptName: 'MyScript', scriptTitle: 'My Script', version: '1.0', modified: 123 }
    ]);
    const res = await listScripts({ _deps: { evaluateAsync } });
    assert.equal(res.success, true);
    assert.equal(res.source, 'rest_api');
    assert.equal(res.count, 1);
    assert.equal(res.scripts[0].id, 'PUB;abc');
    assert.equal(res.scripts[0].name, 'MyScript');
    assert.equal(res.scripts[0].title, 'My Script');
    assert.equal(res.scripts[0].version, '1.0');
    assert.equal(res.scripts[0].modified, 123);
  });

  it('non-array payload → empty scripts + error', async () => {
    delete process.env.TV_MCP_REST;
    const evaluateAsync = makeEvalAsync({ unexpected: true });
    const res = await listScripts({ _deps: { evaluateAsync } });
    assert.equal(res.count, 0);
    assert.deepEqual(res.scripts, []);
    assert.ok(res.error);
  });

  it('non-2xx → throws TvError(REST_HTTP)', async () => {
    delete process.env.TV_MCP_REST;
    const evaluateAsync = makeEvalAsync(null, { ok: false, status: 500 });
    await assert.rejects(() => listScripts({ _deps: { evaluateAsync } }), (err) => {
      assert.equal(err.code, 'REST_HTTP');
      return true;
    });
  });

  it('TV_MCP_REST=0 → throws TvError(REST_DISABLED) regardless of DI', async () => {
    process.env.TV_MCP_REST = '0';
    await assert.rejects(() => listScripts({ _deps: { evaluateAsync: async () => ({}) } }), (err) => {
      assert.equal(err.code, 'REST_DISABLED');
      return true;
    });
  });

  it('strict-DI: TV_MCP_STRICT_DI=1 + no _deps → throws (singleton bypass removed)', async () => {
    delete process.env.TV_MCP_REST;
    const prevStrict = process.env.TV_MCP_STRICT_DI;
    process.env.TV_MCP_STRICT_DI = '1';
    try {
      await assert.rejects(() => listScripts());
    } finally {
      if (prevStrict === undefined) delete process.env.TV_MCP_STRICT_DI; else process.env.TV_MCP_STRICT_DI = prevStrict;
    }
  });
});

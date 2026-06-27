/**
 * Verifies _deps dependency injection and the skipEnsureEditor behavioral gate
 * in src/core/pine.js.
 *
 * Offline: injects a mock evaluate() and asserts:
 *  - the injected evaluate is used (not the module-level connection import),
 *  - ensurePineEditorOpen() runs by default (extra evaluate call), and
 *  - _internal.skipEnsureEditor skips the editor-open probe entirely.
 *
 * Run: node --test tests/pine_deps.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../src/core/pine.js';

// The compile expression contains the button-click DOM scan; the editor-open
// probe (ensurePineEditorOpen) contains the Monaco-finder predicate. We classify
// each evaluate() call by its expression text so the test can assert *which*
// calls happened, not just how many.
function makeMock() {
  const calls = [];
  const evaluate = async (expr) => {
    calls.push(expr);
    // ensurePineEditorOpen's first probe: "var m = ...; return m !== null"
    // Returning true means "editor already open" -> it short-circuits (1 call).
    if (expr.includes('findMonacoEditor') || expr.includes('m !== null')) {
      return true;
    }
    // compile's button scan returns a clicked-button label (truthy) so the
    // getClient() keyboard fallback is never reached.
    if (expr.includes('save and add to chart') || expr.includes('querySelectorAll')) {
      return 'Save and add to chart';
    }
    return null;
  };
  return { calls, evaluate };
}

describe('pine.js _deps injection + skipEnsureEditor gate', () => {
  it('uses the injected evaluate and opens the editor by default', async () => {
    const { calls, evaluate } = makeMock();

    const result = await compile({ _deps: { evaluate } });

    assert.equal(result.success, true);
    assert.equal(result.button_clicked, 'Save and add to chart');
    // 2 calls: editor-open probe (returns "already open") + the compile button scan.
    assert.equal(calls.length, 2, 'editor-open probe + compile button scan = 2 calls');
    const compileCall = calls.find((e) => e.includes('querySelectorAll'));
    assert.ok(compileCall, 'the compile (button-click) expression must run through the injected evaluate');
  });

  it('skips ensurePineEditorOpen when _internal.skipEnsureEditor is set', async () => {
    const { calls, evaluate } = makeMock();

    const result = await compile({ _deps: { evaluate }, _internal: { skipEnsureEditor: true } });

    assert.equal(result.success, true);
    assert.equal(result.button_clicked, 'Save and add to chart');
    // Only the compile button scan runs — the editor-open probe is gated out.
    assert.equal(calls.length, 1, 'skipEnsureEditor must skip the editor-open probe -> compile call only');
    assert.ok(
      calls[0].includes('querySelectorAll'),
      'the single call must be the compile expression, never the editor-open probe'
    );
  });
});

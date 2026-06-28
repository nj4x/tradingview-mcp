import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeResolver, _resetWarnings } from '../src/core/_resolve.js';

test('returns the dep override mock without singleton fallback', () => {
  _resetWarnings();
  const mockFn = () => 'mock-result';
  const resolve = makeResolver(['evaluate', 'evaluateAsync']);

  // capture stderr to prove no warning was emitted
  const original = process.stderr.write;
  let stderr = '';
  process.stderr.write = (chunk) => { stderr += chunk; return true; };
  try {
    const out = resolve({ evaluate: mockFn, evaluateAsync: mockFn });
    assert.equal(out.evaluate, mockFn);
    assert.equal(out.evaluateAsync, mockFn);
  } finally {
    process.stderr.write = original;
  }
  assert.equal(stderr, '', 'no singleton-fallback warning when deps are provided');
});

test('falls back to singleton and warns once when deps undefined (non-strict)', () => {
  _resetWarnings();
  const prev = process.env.TV_MCP_STRICT_DI;
  delete process.env.TV_MCP_STRICT_DI;

  const original = process.stderr.write;
  let stderr = '';
  process.stderr.write = (chunk) => { stderr += chunk; return true; };

  const resolve = makeResolver(['evaluate', 'evaluateAsync']);
  try {
    const out = resolve(undefined);
    // singleton funcs are real functions imported from connection.js
    assert.equal(typeof out.evaluate, 'function');
    assert.equal(typeof out.evaluateAsync, 'function');
  } finally {
    process.stderr.write = original;
    if (prev === undefined) delete process.env.TV_MCP_STRICT_DI;
    else process.env.TV_MCP_STRICT_DI = prev;
  }

  assert.match(stderr, /singleton fallback for "evaluate"/);
  assert.match(stderr, /singleton fallback for "evaluateAsync"/);

  // warnOnce: a second resolve should not re-warn for the same name
  let stderr2 = '';
  const original2 = process.stderr.write;
  process.stderr.write = (chunk) => { stderr2 += chunk; return true; };
  try {
    resolve(undefined);
  } finally {
    process.stderr.write = original2;
  }
  assert.equal(stderr2, '', 'warning is emitted once per name per process');
});

test('throws [strict-di] on access when TV_MCP_STRICT_DI=1 and dep missing', () => {
  _resetWarnings();
  const prev = process.env.TV_MCP_STRICT_DI;
  process.env.TV_MCP_STRICT_DI = '1';
  const resolve = makeResolver(['evaluate']);
  try {
    // resolve() itself never throws — resolution is lazy. The throw fires on access.
    const out = resolve(undefined);
    assert.throws(
      () => out.evaluate,
      /\[strict-di\] missing _deps\.evaluate/,
    );
    // a provided dep still works under strict mode (no throw)
    const mockFn = () => {};
    const out2 = resolve({ evaluate: mockFn });
    assert.equal(out2.evaluate, mockFn);
  } finally {
    if (prev === undefined) delete process.env.TV_MCP_STRICT_DI;
    else process.env.TV_MCP_STRICT_DI = prev;
  }
});

test('an unaccessed name never throws under strict DI', () => {
  _resetWarnings();
  const prev = process.env.TV_MCP_STRICT_DI;
  process.env.TV_MCP_STRICT_DI = '1';
  const resolve = makeResolver(['evaluate', 'evaluateAsync']);
  try {
    // Only evaluate is injected; evaluateAsync is never read by this call path.
    const mockFn = () => 'ok';
    const out = resolve({ evaluate: mockFn });
    assert.equal(out.evaluate(), 'ok', 'accessing the injected dep works');
    // evaluateAsync getter is simply never touched → no throw, as a real
    // single-evaluate function would behave.
  } finally {
    if (prev === undefined) delete process.env.TV_MCP_STRICT_DI;
    else process.env.TV_MCP_STRICT_DI = prev;
  }
});

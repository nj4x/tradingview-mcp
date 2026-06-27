import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startDiagnostics, getDiagnostics, clearDiagnostics } from '../src/core/diagnostics.js';

// Fixed timestamp used across all tests that need a stable "now"
const FIXED_TS = 1700000000000;

function makeAppend() {
  const calls = [];
  return {
    fn: (line) => calls.push(line),
    calls,
  };
}

test('startDiagnostics writes session_start to ring buffer', () => {
  const { fn, calls } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });

  const all = getDiagnostics();
  assert.equal(all.length, 1);
  assert.equal(all[0].type, 'session_start');
  assert.equal(all[0].ts, FIXED_TS);
});

test('startDiagnostics calls appendLine with session_start JSON', () => {
  const { fn, calls } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });

  assert.equal(calls.length, 1);
  const parsed = JSON.parse(calls[0]);
  assert.equal(parsed.type, 'session_start');
  assert.equal(parsed.ts, FIXED_TS);
});

test('getDiagnostics filters by type', () => {
  const { fn } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });

  const consoleResults = getDiagnostics({ type: 'console' });
  assert.equal(consoleResults.length, 0);

  const sessionResults = getDiagnostics({ type: 'session_start' });
  assert.equal(sessionResults.length, 1);
  assert.equal(sessionResults[0].type, 'session_start');
});

test('getDiagnostics filters by since timestamp', () => {
  const { fn } = makeAppend();
  // start two sessions with different timestamps
  startDiagnostics({ now: () => 1000, appendLine: fn });
  startDiagnostics({ now: () => 2000, appendLine: fn });

  const all = getDiagnostics();
  assert.equal(all.length, 1, 'each startDiagnostics resets ring; only latest session_start present');

  const afterStart = getDiagnostics({ since: 1999 });
  assert.equal(afterStart.length, 1);
  assert.equal(afterStart[0].ts, 2000);

  const afterAll = getDiagnostics({ since: 2001 });
  assert.equal(afterAll.length, 0);
});

test('getDiagnostics limits results with limit param', () => {
  const { fn } = makeAppend();
  // start with ts=1000 so ring has 1 session_start entry
  startDiagnostics({ now: () => 1000, appendLine: fn });

  // limit: 1 keeps the single entry
  const limited = getDiagnostics({ limit: 1 });
  assert.equal(limited.length, 1);

  // limit larger than available returns all available
  const limitLarge = getDiagnostics({ limit: 100 });
  assert.equal(limitLarge.length, 1);
});

test('clearDiagnostics empties ring buffer', () => {
  const { fn } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });

  assert.equal(getDiagnostics().length, 1);

  clearDiagnostics();

  assert.equal(getDiagnostics().length, 0);
});

test('getDiagnostics returns empty array after clearDiagnostics', () => {
  const { fn } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });
  clearDiagnostics();

  const all = getDiagnostics();
  assert.ok(Array.isArray(all));
  assert.equal(all.length, 0);
});

test('getDiagnostics({ type }) returns empty array when no match', () => {
  const { fn } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });

  const result = getDiagnostics({ type: 'nonexistent_type' });
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 0);
});

test('getDiagnostics with no args returns all entries', () => {
  const { fn } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });

  const all = getDiagnostics();
  assert.ok(Array.isArray(all));
  assert.ok(all.length >= 1);
});

test('session_start is the first ring entry after startDiagnostics', () => {
  const { fn } = makeAppend();
  startDiagnostics({ now: () => FIXED_TS, appendLine: fn });

  const all = getDiagnostics();
  assert.equal(all[0].type, 'session_start');
});

test('ring buffer resets on each startDiagnostics call', () => {
  const { fn: fn1 } = makeAppend();
  const { fn: fn2 } = makeAppend();

  startDiagnostics({ now: () => 1000, appendLine: fn1 });
  const firstRing = getDiagnostics();
  assert.equal(firstRing[0].ts, 1000);

  startDiagnostics({ now: () => 2000, appendLine: fn2 });
  const secondRing = getDiagnostics();
  assert.equal(secondRing.length, 1);
  assert.equal(secondRing[0].ts, 2000);
});

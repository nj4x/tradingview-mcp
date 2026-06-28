/**
 * Lint rule (PHASE 0e): core modules must not call the connection singleton directly.
 *
 * Every src/core/*.js function that needs to run JS in the renderer must resolve
 * evaluate/evaluateAsync through _deps (via makeResolver), so a pooled tab
 * connection can be injected. The singleton may still be IMPORTED as a fallback
 * reference (aliased `_evaluate`/`_evaluateAsync` and handed to makeResolver), but
 * no module may import the bare `evaluate`/`evaluateAsync` names and call them
 * inline — that bypasses the pool.
 *
 * `getClient` is intentionally NOT covered: it returns the raw CDP client for
 * browser-level domains (Page.captureScreenshot, Target tab management) that are
 * global, not per-tab-evaluate, and are not governed by the connection pool.
 *
 * Offline, no live chart. Run: node --test tests/no-singleton-import.test.js
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = join(__dirname, '..', 'src', 'core');

// These files are infrastructure, not renderer-calling tools.
//  - _resolve.js intentionally imports the singleton to provide it as the fallback.
//  - index.js is a barrel re-export.
//  - withTab.js is the pool injector itself: it imports getLegacyDeps from
//    connection.js and forwards conn.evaluate as the _deps the resolver consumes.
//    It is the mechanism that satisfies this rule, not a violator of it.
const EXEMPT = new Set(['_resolve.js', 'index.js', 'withTab.js']);

function coreFiles() {
  return readdirSync(CORE_DIR)
    .filter((f) => f.endsWith('.js') && !EXEMPT.has(f))
    .map((f) => ({ name: f, src: readFileSync(join(CORE_DIR, f), 'utf8') }));
}

describe('no-singleton-import lint (0e)', () => {
  it('no core module imports the bare evaluate/evaluateAsync/getClient names', () => {
    const offenders = [];
    // Matches `import { ... } from '../connection.js'` and inspects the named bindings.
    const importRe = /import\s*\{([^}]*)\}\s*from\s*['"]\.\.\/connection\.js['"]/g;
    for (const { name, src } of coreFiles()) {
      let m;
      while ((m = importRe.exec(src)) !== null) {
        const names = m[1].split(',').map((s) => s.trim()).filter(Boolean);
        for (const binding of names) {
          // `evaluate as _evaluate` is fine (aliased fallback). A bare `evaluate`
          // (no `as` rename to an underscore-prefixed local) is forbidden.
          const parts = binding.split(/\s+as\s+/).map((s) => s.trim());
          const local = parts.length === 2 ? parts[1] : parts[0];
          const original = parts[0];
          if (['evaluate', 'evaluateAsync'].includes(original)) {
            if (!local.startsWith('_')) {
              offenders.push(`${name}: imports '${binding}' from connection.js (must alias to _-prefixed fallback)`);
            }
          }
        }
      }
    }
    assert.deepEqual(offenders, [], `Direct singleton imports found:\n${offenders.join('\n')}`);
  });

  it('every core module that runs renderer JS resolves through _deps', () => {
    const offenders = [];
    for (const { name, src } of coreFiles()) {
      const importsSingleton = /import\s*\{[^}]*\}\s*from\s*['"]\.\.\/connection\.js['"]/.test(src)
        && /(?:^|[^_\w])(evaluate|evaluateAsync)\s*\(/.test(src);
      if (!importsSingleton) continue;
      // If it ever calls evaluate(...), it must also resolve via makeResolver/_resolve.
      const usesResolver = /makeResolver|_resolve\s*\(/.test(src);
      if (!usesResolver) {
        offenders.push(`${name}: calls evaluate() but never resolves through makeResolver/_deps`);
      }
    }
    assert.deepEqual(offenders, [], `Modules bypassing the resolver:\n${offenders.join('\n')}`);
  });
});

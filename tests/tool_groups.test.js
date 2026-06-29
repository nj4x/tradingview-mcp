/**
 * Tool exposure groups — pure offline unit tests (no CDP, no live chart).
 *
 * IMPORTANT: never import src/server.js here — it has a top-level
 * `await server.connect(transport)` that would attempt a CDP connection and
 * hang/crash offline. We import only _groups.js and the 22 individual
 * tool registrar modules, and exercise them with a mock registrar.
 *
 * Run: node --test tests/tool_groups.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EXTENDED_TOOLS } from '../src/tools/_groups.js';
import { registerHealthTools } from '../src/tools/health.js';
import { registerChartTools } from '../src/tools/chart.js';
import { registerPineTools } from '../src/tools/pine.js';
import { registerDataTools } from '../src/tools/data.js';
import { registerCaptureTools } from '../src/tools/capture.js';
import { registerDrawingTools } from '../src/tools/drawing.js';
import { registerAlertTools } from '../src/tools/alerts.js';
import { registerBatchTools } from '../src/tools/batch.js';
import { registerReplayTools } from '../src/tools/replay.js';
import { registerIndicatorTools } from '../src/tools/indicators.js';
import { registerWatchlistTools } from '../src/tools/watchlist.js';
import { registerUiTools } from '../src/tools/ui.js';
import { registerPaneTools } from '../src/tools/pane.js';
import { registerTabTools } from '../src/tools/tab.js';
import { registerNewsTools } from '../src/tools/news.js';
import { registerOptionsTools } from '../src/tools/options.js';
import { registerFinancialsTools } from '../src/tools/financials.js';
import { registerEtfTools } from '../src/tools/etf.js';
import { registerBondsTools } from '../src/tools/bonds.js';
import { registerTechnicalsTools } from '../src/tools/technicals.js';
import { registerDocumentsTools } from '../src/tools/documents.js';
import { registerCommunityTools } from '../src/tools/community.js';

const ALL_REGISTRARS = [
  registerHealthTools, registerChartTools, registerPineTools, registerDataTools,
  registerCaptureTools, registerDrawingTools, registerAlertTools, registerBatchTools,
  registerReplayTools, registerIndicatorTools, registerWatchlistTools, registerUiTools,
  registerPaneTools, registerTabTools, registerNewsTools, registerOptionsTools,
  registerFinancialsTools, registerEtfTools, registerBondsTools, registerTechnicalsTools,
  registerDocumentsTools, registerCommunityTools,
];

/** Mock that collects every tool name passed to .tool(). */
function makeCollector() {
  const names = [];
  const mock = {
    tool(name, ...rest) {
      names.push(name);
      // mimic the real RegisteredTool return shape minimally
      return { name };
    },
  };
  return { mock, names };
}

/** Collect all names registered across all 22 registrars on a given target. */
function registerAll(target) {
  for (const reg of ALL_REGISTRARS) reg(target);
}

describe('EXTENDED_TOOLS', () => {
  it('contains exactly 82 tool names', () => {
    assert.equal(EXTENDED_TOOLS.size, 82);
  });

  it('gates TradingView launch/health and community tools', () => {
    for (const name of ['tv_launch', 'tv_health_check', 'community_get_ideas', 'community_get_minds', 'community_get_scripts']) {
      assert.ok(EXTENDED_TOOLS.has(name), `${name} should be gated`);
    }
  });
});

describe('full tool surface', () => {
  it('all 22 registrars register exactly 99 unique tool names', () => {
    const { mock, names } = makeCollector();
    registerAll(mock);
    assert.equal(names.length, 99, `expected 99 .tool() calls, got ${names.length}`);
    const unique = new Set(names);
    assert.equal(unique.size, 99, `expected 99 unique names, got ${unique.size} (duplicate registration?)`);
  });

  it('every EXTENDED_TOOLS name exists in the registered surface (catches typos)', () => {
    const { mock, names } = makeCollector();
    registerAll(mock);
    const all = new Set(names);
    for (const name of EXTENDED_TOOLS) {
      assert.ok(all.has(name), `EXTENDED_TOOLS lists "${name}" but no registrar registers it`);
    }
  });
});

describe('default-mode registrar proxy', () => {
  it('registers exactly 17 tools (99 - 82 gated)', () => {
    const { mock: server, names } = makeCollector();
    // Proxy mirrors src/server.js default-mode behavior.
    const registrar = {
      tool(name, ...rest) {
        return EXTENDED_TOOLS.has(name) ? undefined : server.tool(name, ...rest);
      },
    };
    registerAll(registrar);
    assert.equal(names.length, 17, `expected 17 registered tools, got ${names.length}`);
    // none of the gated tools leaked through
    for (const name of names) {
      assert.ok(!EXTENDED_TOOLS.has(name), `gated tool "${name}" leaked into default surface`);
    }
  });

  it('returns undefined for a gated tool and passes through non-gated', () => {
    const { mock: server } = makeCollector();
    const registrar = {
      tool(name, ...rest) {
        return EXTENDED_TOOLS.has(name) ? undefined : server.tool(name, ...rest);
      },
    };
    assert.equal(registrar.tool('pine_get_source', () => {}), undefined);
    const kept = registrar.tool('quote_get', () => {});
    assert.ok(kept && kept.name === 'quote_get');
  });
});

describe('extended-mode registrar', () => {
  it('passthrough server registers all 99 tools', () => {
    const { mock: server, names } = makeCollector();
    // extended mode passes `server` straight through (registrar === server)
    registerAll(server);
    assert.equal(names.length, 99, `expected 99 registered tools, got ${names.length}`);
  });
});

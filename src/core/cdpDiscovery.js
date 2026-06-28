// src/core/cdpDiscovery.js
import CDP from 'chrome-remote-interface';
import { CdpConnection } from './CdpConnection.js';
import { waitForChartReady } from '../wait.js';
import { TvError } from './TvError.js';

const HOST = process.env.TV_MCP_CDP_HOST || 'localhost';
const PORT = Number(process.env.TV_MCP_CDP_PORT || 9222);
const CHART_RE = /tradingview\.com\/chart/i;

/** GET /json/list, filtered to TradingView chart page targets. */
export async function listChartTargets() {
  let targets;
  try {
    const resp = await fetch(`http://${HOST}:${PORT}/json/list`);
    targets = await resp.json();
  } catch (e) {
    throw new TvError('CDP_DOWN', `CDP unreachable at ${HOST}:${PORT}: ${e.message}`,
      { cause: e });
  }
  return targets.filter(t => t.type === 'page' && CHART_RE.test(t.url));
}

/**
 * Attach a CdpConnection to an existing target id, enabling required domains.
 *
 * NOTE: Page.enable and DOM.enable are intentionally omitted here.
 * They subscribe the CDP client to page lifecycle and DOM mutation events.
 * When a subsequent window.open() fires (via tryWindowOpen tab creation),
 * Electron routes those events through TV's BrowserView.autoResize handler,
 * which crashes if the new BrowserWindow's ownerWindow is not yet set up.
 * All project code uses Runtime.evaluate for DOM access and evaluation;
 * Page/DOM method calls (e.g. Page.captureScreenshot, Page.navigate) work
 * without enabling the event subscriptions first.
 */
export async function attach(target, { role = 'worker', selfCreated = false } = {}) {
  let client;
  try {
    client = await CDP({ host: HOST, port: PORT, target: target.id });
    await client.Runtime.enable();
    await enableSafe(client, 'Log');
    if (process.env.TV_MCP_NETWORK === '1') await enableSafe(client, 'Network');
  } catch (e) {
    if (client) { try { await client.close(); } catch {} }
    throw new TvError('CDP_DOWN', `attach failed for ${target.id}: ${e.message}`,
      { cause: e });
  }
  return new CdpConnection(client, target, { role, selfCreated });
}

async function enableSafe(c, domain) {
  if (!c[domain]) return;
  try { await c[domain].enable(); } catch { /* domain unsupported */ }
}

/**
 * Create a NEW chart tab and return a ready CdpConnection for it.
 *
 * Strategy (CDP-1):
 *   1. Best-effort: PUT /json/new?<chartUrl>. If the Electron build supports it we get
 *      a target descriptor back immediately — race-safe (atomic per-call id).
 *   2. window.open() eval on an existing chart page. Electron intercepts the call and
 *      opens a new BrowserWindow that appears as a page target in /json/list.
 *      Race-safe via _windowOpenLock (serializes before/after diff). DO NOT use
 *      URL hash fragments (#…) — they trigger a BrowserView.autoResize crash in TV.
 *   3. Fallback: Cmd+T keyboard shortcut via core/tab.js. Only used when both above
 *      fail. Racy under concurrency (diff-based, not atomic) — last resort only.
 *
 * Readiness (CDP-2 + OPS-4): we attach the FINAL connection first, then drive
 * waitForChartReady against an evaluate bound to THAT connection. No probe connection.
 *
 * @param {{ tabModule: object, chartUrl?: string }} deps
 *   tabModule = core/tab.js (injected so tests can stub the Cmd+T side effect)
 * @returns {{ conn: CdpConnection, createdTargetId: string }}
 */
export async function createNewTarget({ tabModule, chartUrl, sourceTargetId } = {}) {
  const before = new Set((await listChartTargets()).map(t => t.id));

  // 1) Best-effort PUT /json/new
  let created = await tryPutJsonNew(chartUrl);

  // 2) window.open() in the renderer — serialized for safe before/after diff
  if (!created) created = await tryWindowOpen(chartUrl, sourceTargetId);

  // 3) Fallback: Cmd+T via the existing keyboard path in core/tab.js
  if (!created) {
    await tabModule.newTab();             // dispatches Cmd/Ctrl+T, waits ~2s internally
    const after = await listChartTargets();
    created = after.find(t => !before.has(t.id)) || null;
    if (!created) {
      throw new TvError('CDP_DOWN',
        'tab creation failed: PUT /json/new, window.open, and Cmd+T all failed to produce a new target');
    }
  }

  const conn = await attach(created, { role: 'worker', selfCreated: true });

  // Readiness against the FINAL connection (real wait.js). waitForChartReady only checks
  // loading spinners, bar-count stability, and an optional symbol match — it does NOT
  // detect login screens, subscription walls, or blank tabs. It returns `false` on
  // timeout; the pool proceeds with creation regardless — a newly-created tab that lands
  // on a login screen or subscription wall will time out on the first `evaluate()` call
  // and self-evict via the `'disconnect'` handler.
  // wait.js's waitForChartReady uses evaluate(); we pass conn.evaluate via _deps shim.
  await waitForChartReady(null, null, undefined, {
    evaluate: (expr) => conn.evaluate(expr),
  });
  // Readiness is best-effort (mirrors today's behavior): a false return doesn't fail
  // creation — the tab exists and is usable; the first real op surfaces genuine errors.
  return { conn, createdTargetId: created.id };
}

// Serialization lock for window.open-based tab creation.
// window.open produces a target identified by before/after list diff; concurrent
// callers would see the same before-snapshot and mis-attribute targets. Serializing
// ensures each caller's diff is unambiguous. The lock is a promise chain.
let _windowOpenLock = Promise.resolve();

/**
 * Open a new chart tab via window.open() in the primary renderer (strategy 2).
 * Serializes all callers so the before/after list diff is unambiguous.
 *
 * Two-step, because this Electron build does NOT auto-navigate a window.open(url):
 *   1. window.open('about:blank', '_blank') — creates a blank page target instantly.
 *      Opening 'about:blank' (no real URL, no hash) avoids the BrowserView.autoResize
 *      crash that a navigating window.open / URL hash fragment triggers.
 *   2. Attach to the new blank target and set location.href = chartUrl via
 *      Runtime.evaluate. The tab navigates to the chart and starts matching CHART_RE.
 *
 * Never uses URL hash fragments (#…) anywhere — they crash TV's BrowserView.autoResize.
 * Returns a target descriptor (already on the chart URL) or null on timeout.
 *
 * @param {string} [chartUrl]       URL to navigate the new tab to (defaults to source's URL)
 * @param {string} [sourceTargetId] STABLE target to originate window.open from. The pool
 *   passes its primary id here. Without it we fall back to listChartTargets()[0], but under
 *   concurrency that can resolve to a sibling's freshly-created (still-loading) tab, whose
 *   window.open silently no-ops — so the pool must always pass its primary.
 */
async function tryWindowOpen(chartUrl, sourceTargetId) {
  // Acquire serialization lock
  let release;
  const previous = _windowOpenLock;
  _windowOpenLock = new Promise(r => { release = r; });
  await previous;

  try {
    const charts = await listChartTargets();
    if (charts.length === 0) return null;
    // Originate window.open from a STABLE source renderer. If the caller named one
    // (the pool always passes its primary id), it MUST still exist — fail fast rather
    // than fall back to charts[0]. Under concurrency charts[0] can be a sibling's
    // freshly-created, still-loading tab whose window.open silently no-ops, which is
    // the exact race this sourceTargetId parameter exists to prevent. Only when NO
    // source was named (e.g. the first ensurePrimary, which is non-concurrent) do we
    // use charts[0].
    let source;
    if (sourceTargetId) {
      source = charts.find(t => t.id === sourceTargetId) || null;
      if (!source) return null; // named source gone — caller will escalate/retry
    } else {
      source = charts[0];
    }

    // Snapshot ALL targets (chart + non-chart) before we open the new window.
    // If this fetch fails we get an empty set — abort rather than proceed, because an
    // empty allBefore would let the post-open diff match a PRE-EXISTING page and we'd
    // wrongly navigate someone else's tab to the chart URL.
    const beforeIds = await fetch(`http://${HOST}:${PORT}/json/list`)
      .then(r => r.json())
      .then(list => list.map(t => t.id))
      .catch(() => null);
    if (!beforeIds || beforeIds.length === 0) return null;
    const allBefore = new Set(beforeIds);

    // Strip any hash — hash fragments trigger BrowserView.autoResize crash in TV's Electron.
    const openUrl = ((chartUrl || source.url || '').split('#')[0])
      || 'https://www.tradingview.com/chart/';

    // Step 1: open a BLANK window (no navigation → no autoResize crash).
    let evalClient;
    try {
      evalClient = await CDP({ host: HOST, port: PORT, target: source.id });
      await evalClient.Runtime.enable();
      await evalClient.Runtime.evaluate({
        expression: `window.open('about:blank', '_blank')`,
        returnByValue: false,
      });
    } finally {
      if (evalClient) { try { await evalClient.close(); } catch {} }
    }

    // Find the new blank page target (appears near-instantly with an empty URL).
    let blank = null;
    const blankDeadline = Date.now() + 4000;
    while (Date.now() < blankDeadline && !blank) {
      await new Promise(r => setTimeout(r, 150));
      const all = await fetch(`http://${HOST}:${PORT}/json/list`)
        .then(r => r.json()).catch(() => []);
      blank = all.find(t => t.type === 'page' && !allBefore.has(t.id)) || null;
    }
    if (!blank) return null; // window.open produced no target

    // Once the blank tab exists, ANY subsequent failure (attach throw, nav throw,
    // navigation timeout) must close it — otherwise it leaks as a permanent zombie
    // that is never tracked in _createdTargetIds and never cleaned by drain().
    try {
      // Step 2: navigate the blank tab to the chart URL via location.href.
      let navClient;
      try {
        navClient = await CDP({ host: HOST, port: PORT, target: blank.id });
        await navClient.Runtime.enable();
        await navClient.Runtime.evaluate({
          expression: `location.href = ${JSON.stringify(openUrl)}`,
          returnByValue: false,
        });
      } finally {
        if (navClient) { try { await navClient.close(); } catch {} }
      }

      // Poll until the tab's URL matches the chart filter (5 s, 300 ms interval).
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 300));
        const after = await listChartTargets().catch(() => []);
        const created = after.find(t => t.id === blank.id);
        if (created) return created;
      }
      // Navigation never reached a chart URL within the deadline.
      await closeTarget(blank.id).catch(() => {});
      return null;
    } catch (e) {
      // Attach/nav threw after the blank tab was created — clean it up, then rethrow.
      await closeTarget(blank.id).catch(() => {});
      throw e;
    }
  } finally {
    release();
  }
}

async function tryPutJsonNew(chartUrl) {
  const url = chartUrl
    ? `http://${HOST}:${PORT}/json/new?${encodeURIComponent(chartUrl)}`
    : `http://${HOST}:${PORT}/json/new`;
  try {
    const resp = await fetch(url, { method: 'PUT' });
    if (resp.status === 404 || resp.status === 405) return null; // unsupported build
    if (!resp.ok) return null;
    const t = await resp.json();
    if (t && t.id) return { id: t.id, url: t.url || chartUrl || '', title: t.title || '' };
    return null;
  } catch {
    return null; // network refused / method unsupported → fall back to Cmd+T
  }
}

/** DELETE /json/close/<id> — used by the pool to clean up self-created tabs (OPS-2). */
export async function closeTarget(id) {
  try {
    const resp = await fetch(`http://${HOST}:${PORT}/json/close/${id}`, { method: 'DELETE' });
    return resp.ok;
  } catch { return false; }
}

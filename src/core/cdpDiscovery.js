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

/** Attach a CdpConnection to an existing target id, enabling required domains. */
export async function attach(target, { role = 'worker', selfCreated = false } = {}) {
  let client;
  try {
    client = await CDP({ host: HOST, port: PORT, target: target.id });
    await client.Runtime.enable();
    await client.Page.enable();
    await client.DOM.enable();
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
 *      a target descriptor back immediately.
 *   2. On 404/405/network refusal: fall back to the EXISTING Cmd+T path. We diff the
 *      target list before/after to find the newly-created target.
 *
 * Readiness (CDP-2 + OPS-4): we attach the FINAL connection first, then drive
 * waitForChartReady against an evaluate bound to THAT connection. No probe connection.
 *
 * @param {{ tabModule: object, chartUrl?: string }} deps
 *   tabModule = core/tab.js (injected so tests can stub the Cmd+T side effect)
 * @returns {{ conn: CdpConnection, createdTargetId: string }}
 */
export async function createNewTarget({ tabModule, chartUrl } = {}) {
  const before = new Set((await listChartTargets()).map(t => t.id));

  // 1) Best-effort PUT /json/new
  let created = await tryPutJsonNew(chartUrl);

  // 2) Fallback: Cmd+T via the existing keyboard path in core/tab.js
  if (!created) {
    await tabModule.newTab();             // dispatches Cmd/Ctrl+T, waits ~2s internally
    const after = await listChartTargets();
    created = after.find(t => !before.has(t.id)) || null;
    if (!created) {
      throw new TvError('CDP_DOWN',
        'tab creation failed: neither PUT /json/new nor Cmd+T produced a new target');
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

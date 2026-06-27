import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setDiagnosticsSink } from '../connection.js';

const RING_MAX = 10000;
const LOG_DIR = path.join(os.homedir(), '.tradingview-mcp', 'logs', 'diagnostics');

let ring = [];
let _appendLineFn = (line) => {};

function sink(event) {
  if (ring.length >= RING_MAX) ring.shift();
  ring.push(event);
  _appendLineFn(JSON.stringify(event));
}

function attachListeners(client) {
  client.Runtime.on('consoleAPICalled', (evt) => sink({
    type: 'console',
    level: evt.type,
    text: (evt.args || []).map(a => a.value ?? a.description ?? '').join(' '),
    ts: Date.now(),
  }));

  client.Runtime.on('exceptionThrown', (evt) => sink({
    type: 'exception',
    text: evt.exceptionDetails?.text,
    stack: evt.exceptionDetails?.stackTrace,
    ts: Date.now(),
  }));

  if (client.Log) {
    client.Log.on('entryAdded', (evt) => sink({
      type: 'log',
      level: evt.entry?.level,
      text: evt.entry?.text,
      source: evt.entry?.source,
      url: evt.entry?.url,
      ts: Date.now(),
    }));
  }

  if (process.env.TV_MCP_NETWORK === '1' && client.Network) {
    const urlFilter = (url) => /chart|datafeed|symbol|tv-tickers/.test(url ?? '');

    client.Network.on('responseReceived', (evt) => {
      if (!urlFilter(evt.response?.url)) return;
      sink({ type: 'network_response', url: evt.response.url, status: evt.response.status, ts: Date.now() });
    });

    client.Network.on('loadingFailed', (evt) => {
      if (!urlFilter(evt.documentURL)) return;
      sink({ type: 'network_failed', url: evt.documentURL, error: evt.errorText, ts: Date.now() });
    });

    if (process.env.TV_MCP_WS_FRAMES === '1') {
      client.Network.on('webSocketFrameReceived', (evt) => sink({
        type: 'ws_frame',
        requestId: evt.requestId,
        payload: evt.response?.payloadData,
        ts: Date.now(),
      }));
    }
  }
}

export function startDiagnostics(_deps = {}) {
  const now = _deps.now ?? (() => Date.now());
  const appendLine = _deps.appendLine ?? ((line) => {
    fs.promises.appendFile(sessionFile, line + '\n').catch(() => {});
  });

  fs.mkdirSync(LOG_DIR, { recursive: true });

  const ts = now();
  const isoTs = new Date(ts).toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  let sessionFile = path.join(LOG_DIR, `session_${isoTs}.jsonl`);

  const current = path.join(LOG_DIR, 'current');
  try { fs.unlinkSync(current); } catch (_) {}
  fs.symlinkSync(sessionFile, current);

  _appendLineFn = appendLine;
  ring = [];

  const startEvent = { type: 'session_start', ts };
  ring.push(startEvent);
  appendLine(JSON.stringify(startEvent));

  setDiagnosticsSink(attachListeners);
}

export function getDiagnostics({ type, since, limit } = {}) {
  let results = ring;
  if (type) results = results.filter(e => e.type === type);
  if (since != null) results = results.filter(e => e.ts >= since);
  if (limit) results = results.slice(-Number(limit));
  return results;
}

export function clearDiagnostics() {
  ring = [];
}

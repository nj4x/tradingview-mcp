#!/usr/bin/env node

/**
 * TradingView API enumeration — discover hidden capabilities not yet wired as MCP tools.
 * Connects to CDP, walks known TradingView API roots, and exports findings to JSONL.
 *
 * Usage: node scripts/probe_api.js [port]
 * Output: ~/.tradingview-mcp/logs/probe/probe_<timestamp>.jsonl
 */

import CDP from 'chrome-remote-interface';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const CDP_PORT = parseInt(process.argv[2] ?? '9222', 10);
const PROBE_DIR = path.join(os.homedir(), '.tradingview-mcp', 'logs', 'probe');

fs.mkdirSync(PROBE_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outputFile = path.join(PROBE_DIR, `probe_${timestamp}.jsonl`);

let client;
let Runtime;

async function evaluate(expr) {
  try {
    const { result } = await Runtime.evaluate({
      expression: expr,
      returnByValue: true,
      awaitPromise: false,
    });
    if (result.exceptionDetails) return null;
    return result.value;
  } catch {
    return null;
  }
}

function appendLine(line) {
  fs.promises.appendFile(outputFile, line + '\n').catch(() => {});
}

async function probeObject(path, depth = 0, visited = new Set()) {
  if (depth > 3 || visited.size > 500) return;
  if (visited.has(path)) return;
  visited.add(path);

  const expr = `
    (function() {
      try {
        var obj = (${path});
        if (!obj || typeof obj !== 'object') return null;
        var keys = Object.keys(obj);
        var result = {};
        for (var i = 0; i < Math.min(keys.length, 50); i++) {
          var k = keys[i];
          var v = obj[k];
          var t = typeof v;
          result[k] = { type: t, arity: (t === 'function' ? (v.length || 0) : null) };
        }
        return result;
      } catch (e) {
        return null;
      }
    })()
  `;

  const keys = await evaluate(expr);
  if (!keys) return;

  for (const [key, meta] of Object.entries(keys)) {
    const finding = {
      path: path + '.' + key,
      type: meta.type,
      arity: meta.arity,
      ts: Date.now(),
    };
    appendLine(JSON.stringify(finding));
  }
}

async function main() {
  try {
    // Connect to CDP
    const targets = await CDP.List({ host: 'localhost', port: CDP_PORT });
    const chartTarget = targets.find(t => t.url && t.url.includes('tradingview'));
    if (!chartTarget) throw new Error('No TradingView target found');

    client = await CDP({ host: 'localhost', port: CDP_PORT, target: chartTarget.id });
    await client.Runtime.enable();
    Runtime = client.Runtime;

    console.log(`Probing TradingView API at ${chartTarget.url}`);
    console.log(`Output: ${outputFile}`);
    console.log('');

    const roots = [
      'window.TradingViewApi',
      'window.ChartApiInstance',
      'window.TradingView',
      'window.tv',
    ];

    for (const root of roots) {
      console.log(`Exploring ${root}...`);
      await probeObject(root, 0);
      await probeObject(root + '._activeChartWidgetWV.value()', 1);
      await probeObject(root + '._activeChartWidgetWV.value()._chartWidget', 1);
      await probeObject(root + '._activeChartWidgetWV.value()._chartWidget.model()', 2);
    }

    // Additional deep probes for known paths
    const deepPaths = [
      'window.TradingViewApi._alertService',
      'window.TradingViewApi._replayApi',
      'window.TradingViewApi._chartWidgetCollection',
    ];

    for (const path of deepPaths) {
      console.log(`Deep probe: ${path}...`);
      await probeObject(path, 1);
    }

    console.log('');
    console.log(`✔ Probe complete. Findings written to ${outputFile}`);
    await client.close();
  } catch (err) {
    console.error('Probe failed:', err.message);
    process.exit(1);
  }
}

main();

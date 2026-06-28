/**
 * Core batch execution logic.
 */
import { getClient, KNOWN_PATHS, safeString } from '../connection.js';
import { makeResolver } from './_resolve.js';
import { waitForChartReady } from '../wait.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = join(dirname(dirname(__dirname)), 'screenshots');

// Singleton fallback: Page.captureScreenshot on the legacy singleton client.
const _captureScreenshot = async (params) => {
  const c = await getClient();
  return c.Page.captureScreenshot(params ?? {});
};

// Probe whether a path exists on the current tab using the injected evaluate.
async function probeForPath(path, evaluate) {
  try {
    const ok = await evaluate(`typeof (${path}) !== 'undefined' && (${path}) !== null`);
    return ok ? path : null;
  } catch { return null; }
}

const _resolve = makeResolver(['evaluate', 'evaluateAsync'], {
  captureScreenshot: _captureScreenshot,
});

export async function batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count, _deps }) {
  const { evaluate, evaluateAsync, captureScreenshot } = _resolve(_deps);
  const tfs = timeframes && timeframes.length > 0 ? timeframes : [null];
  const delay = delay_ms || 2000;
  const results = [];

  // Probe which API path is reachable on THIS tab (injected evaluate, not the singleton).
  const colPath = await probeForPath(KNOWN_PATHS.chartWidgetCollection, evaluate);
  const apiPath = await probeForPath(KNOWN_PATHS.chartApi, evaluate);

  for (const symbol of symbols) {
    for (const tf of tfs) {
      const combo = { symbol, timeframe: tf };
      try {
        if (colPath) await evaluate(`${colPath}.setSymbol(${safeString(symbol)})`);
        else if (apiPath) await evaluate(`${apiPath}.setSymbol(${safeString(symbol)})`);

        if (tf) {
          if (colPath) await evaluate(`${colPath}.setResolution(${safeString(tf)})`);
          else if (apiPath) await evaluate(`${apiPath}.setResolution(${safeString(tf)})`);
        }

        await waitForChartReady(symbol, null, undefined, _deps);
        await new Promise(r => setTimeout(r, delay));

        let actionResult;
        if (action === 'screenshot') {
          mkdirSync(SCREENSHOT_DIR, { recursive: true });
          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const fname = `batch_${symbol}_${tf || 'default'}_${ts}`.replace(/[\/\\]/g, '_') + '.png';
          const filePath = join(SCREENSHOT_DIR, fname);
          const { data } = await captureScreenshot({ format: 'png' });
          writeFileSync(filePath, Buffer.from(data, 'base64'));
          actionResult = { file_path: filePath };
        } else if (action === 'get_ohlcv' && apiPath) {
          const limit = Math.min(ohlcv_count || 100, 500);
          actionResult = await evaluateAsync(`
            new Promise(function(resolve, reject) {
              ${apiPath}.exportData({ includeTime: true, includeSeries: true, includeStudies: false })
                .then(function(result) {
                  var bars = (result.data || []).slice(-${limit});
                  resolve({ bar_count: bars.length, last_bar: bars[bars.length - 1] || null });
                }).catch(reject);
            })
          `);
        } else if (action === 'get_strategy_results') {
          await new Promise(r => setTimeout(r, 1000));
          actionResult = await evaluate(`
            (function() {
              var metrics = {};
              var panel = document.querySelector('[data-name="backtesting"]') || document.querySelector('[class*="strategyReport"]');
              if (!panel) return { error: 'Strategy Tester not found' };
              var items = panel.querySelectorAll('[class*="reportItem"], [class*="metric"]');
              items.forEach(function(item) {
                var label = item.querySelector('[class*="label"]');
                var value = item.querySelector('[class*="value"]');
                if (label && value) metrics[label.textContent.trim()] = value.textContent.trim();
              });
              return { metric_count: Object.keys(metrics).length, metrics: metrics };
            })()
          `);
        } else {
          actionResult = { error: 'Unknown action or API not available: ' + action };
        }
        results.push({ ...combo, success: true, result: actionResult });
      } catch (err) {
        results.push({ ...combo, success: false, error: err.message });
      }
    }
  }

  const successCount = results.filter(r => r.success).length;
  return { success: true, total_iterations: results.length, successful: successCount, failed: results.length - successCount, results };
}

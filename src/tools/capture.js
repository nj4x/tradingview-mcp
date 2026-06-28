import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/capture.js';
import { withTab } from '../core/withTab.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerCaptureTools(server) {
  server.tool('capture_screenshot', 'Take a screenshot of the TradingView chart', {
    region: z.string().optional().describe('Region to capture: full, chart, strategy_tester (default full)'),
    filename: z.string().optional().describe('Custom filename (without extension)'),
    method: z.string().optional().describe('Capture method: cdp (Page.captureScreenshot) or api (chartWidgetCollection.takeScreenshot) (default cdp)'),
  }, async ({ region, filename, method }) => {
    try {
      const out = await withTab((deps) => core.captureScreenshot({ region, filename, method, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });
}

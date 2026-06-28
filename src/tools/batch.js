import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/batch.js';
import { withTab } from '../core/withTab.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerBatchTools(server) {
  server.tool('batch_run', 'Run an action across multiple symbols and/or timeframes', {
    symbols: z.array(z.string()).describe('Array of symbols to iterate (e.g., ["BTCUSD", "ETHUSD", "AAPL"])'),
    timeframes: z.array(z.string()).optional().describe('Array of timeframes (e.g., ["D", "60", "15"])'),
    action: z.string().describe('Action to run: screenshot, get_ohlcv, get_strategy_results'),
    delay_ms: z.coerce.number().optional().describe('Delay between iterations in ms (default 2000)'),
    ohlcv_count: z.coerce.number().optional().describe('Bar count for get_ohlcv action (default 100)'),
  }, async ({ symbols, timeframes, action, delay_ms, ohlcv_count }) => {
    try {
      const out = await withTab((deps) => core.batchRun({ symbols, timeframes, action, delay_ms, ohlcv_count, _deps: deps }), { route: 'headless' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });
}

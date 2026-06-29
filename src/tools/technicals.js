import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/technicals.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerTechnicalsTools(server) {
  server.tool(
    'technicals_get',
    'Get TradingView\'s aggregate technical-analysis rating for a symbol from the public scanner. ' +
      'Returns recommendation (overall), oscillators, and moving_averages — each a value on a ±1 scale with a label: ' +
      '>0.5 Strong Buy, >0.1 Buy, -0.1..0.1 Neutral, <-0.1 Sell, <-0.5 Strong Sell. ' +
      'The exchange-prefixed symbol (e.g. NASDAQ:AMZN, BINANCE:BTCUSDT) selects the screener; if the prefix is ' +
      'unknown the call falls back to the US screener and sets screener_guessed:true.',
    {
      symbol: z.string().describe('Exchange-prefixed symbol, e.g. "NASDAQ:AMZN", "BINANCE:BTCUSDT", "NYMEX:CL1!".'),
      columns: z.array(z.string()).optional().describe('TradingView scanner columns to request. Omit or pass [] to use all three defaults: "Recommend.All" (overall TA rating), "Recommend.MA" (moving averages rating), "Recommend.Other" (oscillators rating). These are the only recommended values — provide a non-empty custom array only when you need raw scanner columns. Each Recommend value is on a ±1 scale: >0.5 Strong Buy, >0.1 Buy, -0.1..0.1 Neutral, <-0.1 Sell, <-0.5 Strong Sell.'),
      interval: z.enum(['1h', '4h', '1D', '1W', '1M']).optional().describe('Timeframe for the rating (default: daily). Adds a suffix to each column.'),
    },
    async ({ symbol, columns, interval }) => {
      try {
        const out = await core.getTechnicals({ symbol, columns, interval });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    },
  );
}

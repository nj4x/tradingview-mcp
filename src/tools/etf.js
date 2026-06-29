import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/etf.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerEtfTools(server) {
  server.tool(
    'etf_search',
    'Search US-listed ETFs / funds via TradingView\'s public scanner REST API (no auth). With no query, returns the largest funds by AUM. With a query, matches the name/ticker phrase. Each result includes name, description, close price, daily change, AUM, expense ratio, asset class, focus, 3Y NAV return, and 1M fund flows. Works without TradingView Desktop running.',
    {
      query: z.string().optional().describe('Name or ticker phrase to search for (e.g. "S&P 500", "VOO", "semiconductor"). Omit to list the largest funds by AUM.'),
      limit: z.coerce.number().optional().describe('Max ETFs to return (default 50, clamped to 1-200)'),
    },
    async (args) => {
      try {
        const out = await core.searchEtfs(args);
        return jsonResult(out);
      } catch (err) { return fail(err); }
    }
  );

  server.tool(
    'etf_get',
    'Get detailed data for a single ETF by exact symbol (e.g. "AMEX:VOO", "NASDAQ:QQQ") via TradingView\'s public scanner REST API (no auth). Returns name, description, close price, daily change, AUM, expense ratio, asset class, focus, 3Y NAV return, and 1M fund flows. Throws if the symbol is not a known fund. Works without TradingView Desktop running.',
    {
      symbol: z.string().describe('Exact ETF symbol including exchange prefix (e.g. "AMEX:VOO", "NASDAQ:QQQ")'),
    },
    async (args) => {
      try {
        const out = await core.getEtf(args);
        return jsonResult(out);
      } catch (err) { return fail(err); }
    }
  );
}

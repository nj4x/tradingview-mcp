import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/options.js';
import { withTab } from '../core/withTab.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerOptionsTools(server) {
  server.tool(
    'options_search',
    'Search options contracts for an underlying symbol. Uses TradingView\'s public symbol-search REST API (no auth), falling back to the authenticated renderer session when REST is empty. Filter by expiry window, contract type (call/put), and strike range. Returns deduplicated contracts sorted by strike.',
    {
      underlying: z.string().describe('Underlying symbol to search options for (e.g. "AAPL", "SPY", "TSLA")'),
      expiry_after: z.string().optional().describe('Only contracts expiring on/after this date (YYYY-MM-DD)'),
      expiry_before: z.string().optional().describe('Only contracts expiring on/before this date (YYYY-MM-DD)'),
      contract_type: z.enum(['call', 'put']).optional().describe('Filter by contract type: "call" or "put"'),
      strike_min: z.coerce.number().optional().describe('Minimum strike price (inclusive)'),
      strike_max: z.coerce.number().optional().describe('Maximum strike price (inclusive)'),
      limit: z.coerce.number().optional().describe('Max contracts to return (default 50, capped at 500)'),
    },
    async (args) => {
      try {
        const out = await withTab((deps) => core.searchContracts({ ...args, _deps: deps }), { route: 'headless' });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    }
  );
}

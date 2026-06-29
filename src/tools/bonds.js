import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/bonds.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerBondsTools(server) {
  server.tool(
    'bond_search',
    'Search global bonds via TradingView\'s public bond scanner. Returns symbol, name, description, coupon, yield-to-maturity (decimal: 0.045 = 4.5%), maturity date (ISO), close, and change. Sorted by yield (highest first). Optionally filter by maturity date window, yield range, or a search phrase.',
    {
      query: z.string().optional().describe('Search phrase to match bond name/description (e.g., "Treasury", "Apple").'),
      maturity_after: z.string().optional().describe('Only bonds maturing after this date (YYYY-MM-DD).'),
      maturity_before: z.string().optional().describe('Only bonds maturing before this date (YYYY-MM-DD).'),
      min_yield: z.coerce.number().optional().describe('Minimum yield-to-maturity as a decimal (e.g., 0.04 = 4%).'),
      max_yield: z.coerce.number().optional().describe('Maximum yield-to-maturity as a decimal (e.g., 0.08 = 8%).'),
      limit: z.coerce.number().optional().describe('Max results, clamped 1-200 (default 50).'),
    },
    async ({ query, maturity_after, maturity_before, min_yield, max_yield, limit }) => {
      try {
        const out = await core.searchBonds({ query, maturity_after, maturity_before, min_yield, max_yield, limit });
        return jsonResult(out);
      } catch (err) {
        return fail(err);
      }
    },
  );
}

import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/financials.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerFinancialsTools(server) {
  server.tool(
    'financials_get',
    'Get fundamental financials for a symbol (revenue, gross profit, net income, EBITDA, EBIT, total assets/liabilities/equity, P/E TTM, P/B, P/CF, EPS basic TTM). Reads TradingView\'s public scanner endpoint — works without TradingView Desktop running.',
    {
      symbol: z.string().describe('Symbol to fetch (e.g., NASDAQ:AMZN, AAPL, NYSE:JPM)'),
      fields: z.string().optional().describe('Optional comma-separated list of scanner fields to override the defaults (e.g., "total_revenue,net_income,ebitda")'),
    },
    async ({ symbol, fields }) => {
      try {
        const out = await core.fetchFinancials({ symbol, fields });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    },
  );

  server.tool(
    'forecast_get',
    'Get analyst forecast & consensus for a symbol: price targets (average/high/low/median), recommendation breakdown (buy/hold/sell), recommendation_mark with a derived recommendation_label (Strong Buy..Strong Sell), next-quarter EPS/revenue estimates, and earnings release dates. Works without TradingView Desktop running.',
    {
      symbol: z.string().describe('Symbol to fetch (e.g., NASDAQ:AMZN, AAPL, NYSE:JPM)'),
      fields: z.string().optional().describe('Optional comma-separated list of scanner fields to override the defaults (e.g., "price_target_average,recommendation_mark")'),
    },
    async ({ symbol, fields }) => {
      try {
        const out = await core.fetchForecast({ symbol, fields });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    },
  );
}

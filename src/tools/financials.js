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
      fields: z.string().optional().describe('Comma-separated TradingView scanner field names to override the defaults. Omit or pass an empty string to request all default fields: total_revenue, gross_profit, net_income, oper_income, ebitda, ebit, total_assets, total_liabilities, total_equity, price_earnings_ttm, price_book, price_cash_flow, earnings_per_share_basic_ttm. Pass a non-empty subset to narrow the response.'),
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
      fields: z.string().optional().describe('Comma-separated TradingView scanner field names to override the defaults. Omit or pass an empty string to request all default fields: price_target_average, price_target_high, price_target_low, price_target_median, price_target_estimates_num, recommendation_mark, recommendation_buy, recommendation_hold, recommendation_sell, recommendation_total, earnings_per_share_forecast_next_fq, revenue_forecast_next_fq, earnings_release_next_date, earnings_release_date. Pass a non-empty subset to narrow the response.'),
    },
    async ({ symbol, fields }) => {
      try {
        const out = await core.fetchForecast({ symbol, fields });
        return jsonResult(out);
      } catch (err) { return fail(err); }
    },
  );
}

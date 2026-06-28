import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/chart.js';
import { withTab } from '../core/withTab.js';
import { TvError } from '../core/TvError.js';

function fail(err) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable },
    true,
  );
}

export function registerChartTools(server) {
  server.tool('chart_get_state', 'Get current chart state (symbol, timeframe, chart type, indicators)', {}, async () => {
    try {
      const out = await withTab((deps) => core.getState({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_set_symbol', 'Change the chart symbol', {
    symbol: z.string().describe('Symbol to set (e.g., BTCUSD, AAPL, ES1!, NYMEX:CL1!)'),
  }, async ({ symbol }) => {
    try {
      const out = await withTab((deps) => core.setSymbol({ symbol, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_set_timeframe', 'Change the chart timeframe/resolution', {
    timeframe: z.string().describe('Timeframe (e.g., 1, 5, 15, 60, D, W, M)'),
  }, async ({ timeframe }) => {
    try {
      const out = await withTab((deps) => core.setTimeframe({ timeframe, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_set_type', 'Change chart type', {
    chart_type: z.string().describe('Chart type: Bars(0), Candles(1), Line(2), Area(3), Renko(4), Kagi(5), PointAndFigure(6), LineBreak(7), HeikinAshi(8), HollowCandles(9) — pass name or number'),
  }, async ({ chart_type }) => {
    try {
      const out = await withTab((deps) => core.setType({ chart_type, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_manage_indicator', 'Add or remove an indicator/study on the chart', {
    action: z.enum(['add', 'remove']).describe('Action: add or remove'),
    indicator: z.string().describe('Full indicator name: "Relative Strength Index", "MACD", "Volume", "Moving Average", "Bollinger Bands", "Moving Average Exponential". Short names like RSI/EMA do NOT work.'),
    entity_id: z.string().optional().describe('Entity ID to remove (from chart_get_state). Required for remove.'),
    inputs: z.string().optional().describe('JSON string of input overrides for the indicator (e.g., \'{"length": 20}\')'),
  }, async ({ action, indicator, entity_id, inputs }) => {
    try {
      const out = await withTab((deps) => core.manageIndicator({ action, indicator, entity_id, inputs, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_get_visible_range', 'Get the visible date range (unix timestamps) and bars range on the chart', {}, async () => {
    try {
      const out = await withTab((deps) => core.getVisibleRange({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_set_visible_range', 'Zoom the chart to a specific date range. Accepts unix timestamps (seconds) or ISO date strings like "2025-01-15".', {
    from: z.union([z.coerce.number(), z.string()]).describe('Start of range — unix timestamp (seconds) or ISO date string (e.g., "2025-01-15")'),
    to: z.union([z.coerce.number(), z.string()]).describe('End of range — unix timestamp (seconds) or ISO date string (e.g., "2025-01-20")'),
  }, async ({ from, to }) => {
    try {
      const out = await withTab((deps) => core.setVisibleRange({ from, to, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_scroll_to_date', 'Jump the chart view to center on a specific date', {
    date: z.string().describe('ISO date string (e.g., "2024-01-15") or unix timestamp as a string'),
  }, async ({ date }) => {
    try {
      const out = await withTab((deps) => core.scrollToDate({ date, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('symbol_info', 'Get detailed metadata about a symbol (name, exchange, type, description). Switches to the symbol if needed — does NOT restore the previous symbol.', {
    symbol: z.string().describe('Symbol to inspect (e.g., "AAPL", "ES1!", "NYMEX:CL1!")'),
  }, async ({ symbol }) => {
    try {
      const out = await withTab((deps) => core.symbolInfo({ symbol, _deps: deps }), { route: 'headless', symbol });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('symbol_search', 'Search for symbols by name or keyword', {
    query: z.string().describe('Search query (e.g., "AAPL", "crude oil", "ES")'),
    type: z.string().optional().describe('Filter by type (e.g., "stock", "futures", "crypto", "forex", "option")'),
  }, async ({ query, type }) => {
    try {
      const out = await withTab((deps) => core.symbolSearch({ query, type, _deps: deps }), { route: 'headless' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('symbol_search_live', 'Search symbols using the logged-in TradingView session (in-app searchSymbols API). Complements symbol_search which is anonymous.', {
    query: z.string().describe('Search query (e.g., "AAPL", "crude oil", "ES")'),
  }, async ({ query }) => {
    try {
      const out = await withTab((deps) => core.symbolSearchLive({ query, _deps: deps }), { route: 'headless' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('chart_report', 'Full chart analysis in one call — batches state, study values, quote, pine graphics, OHLCV summary, and an optional screenshot. Defaults to state+study_values+quote (cheap). Add expensive sections explicitly via include. Per-section error isolation; response capped at 50KB.', {
    include: z.array(z.enum(['state', 'study_values', 'pine_lines', 'pine_labels', 'pine_tables', 'pine_boxes', 'quote', 'ohlcv', 'screenshot'])).optional().describe('Sections to include. Default: ["state","study_values","quote"]. ohlcv and screenshot are expensive — add only when needed.'),
    study_filter: z.string().optional().describe('Substring to match study name for pine_* sections.'),
    ohlcv_count: z.coerce.number().optional().describe('Bars for the ohlcv section (summary stats, default 100).'),
    screenshot_region: z.enum(['full', 'chart', 'strategy_tester']).optional().describe('Region for the screenshot section (default "chart").'),
  }, async ({ include, study_filter, ohlcv_count, screenshot_region }) => {
    try {
      const out = await withTab((deps) => core.analyzeChart({ include, study_filter, ohlcv_count, screenshot_region, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('fetch_ohlcv', 'Fetch OHLCV for any symbol+timeframe in one call. Switches the chart to the requested symbol/timeframe (skipping the switch if already there), then returns bars. NOTE: this mutates the chart and does NOT restore the previous symbol/timeframe.', {
    symbol: z.string().describe('Symbol to fetch (e.g., "AAPL", "ES1!", "NYMEX:CL1!")'),
    timeframe: z.string().optional().describe('Timeframe/resolution (e.g., "1", "5", "60", "D", "W"). Omit to keep the current timeframe.'),
    count: z.coerce.number().optional().describe('Number of bars (default 100, capped at 500)'),
    summary: z.boolean().optional().describe('Return compact summary stats instead of all bars (recommended)'),
  }, async ({ symbol, timeframe, count, summary }) => {
    try {
      const out = await withTab((deps) => core.fetchOhlcv({ symbol, timeframe, count, summary, _deps: deps }), { route: 'headless', symbol });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('market_status', 'Get the market session status for a symbol (open / closed / pre_market / post_market) plus session metadata. Switches to the symbol if needed — does NOT restore the previous symbol.', {
    symbol: z.string().describe('Symbol to check (e.g., "AAPL", "ES1!", "NYMEX:CL1!")'),
  }, async ({ symbol }) => {
    try {
      const out = await withTab((deps) => core.getMarketStatus({ symbol, _deps: deps }), { route: 'headless', symbol });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });
}

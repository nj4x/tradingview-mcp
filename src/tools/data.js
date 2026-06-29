import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/data.js';
import { withTab } from '../core/withTab.js';
import { TvError } from '../core/TvError.js';

function fail(err, extra) {
  const e = TvError.from(err);
  return jsonResult(
    { success: false, error: e.message, code: e.code, retryable: e.retryable, ...extra },
    true,
  );
}

export function registerDataTools(server) {
  server.tool('data_get_ohlcv', 'Get OHLCV bar data from the chart. Use summary=true for compact stats instead of all bars (saves context).', {
    count: z.coerce.number().optional().describe('Number of bars to retrieve (max 500, default 100)'),
    summary: z.coerce.boolean().optional().describe('Return summary stats (high, low, open, close, avg volume, range) instead of all bars — much smaller output'),
  }, async ({ count, summary }) => {
    try {
      const out = await withTab((deps) => core.getOhlcv({ count, summary, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_indicator', 'Get indicator/study info and input values', {
    entity_id: z.string().describe('Study entity ID (from chart_get_state)'),
  }, async ({ entity_id }) => {
    try {
      const out = await withTab((deps) => core.getIndicator({ entity_id, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_strategy_results', 'Get strategy performance metrics from Strategy Tester', {}, async () => {
    try {
      const out = await withTab((deps) => core.getStrategyResults({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_trades', 'Get trade list from Strategy Tester', {
    max_trades: z.coerce.number().optional().describe('Maximum trades to return'),
  }, async ({ max_trades }) => {
    try {
      const out = await withTab((deps) => core.getTrades({ max_trades, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_equity', 'Get equity curve data from Strategy Tester', {}, async () => {
    try {
      const out = await withTab((deps) => core.getEquity({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('quote_get', 'Get real-time quote data for a symbol (price, OHLC, volume). Requires symbol. Switches the visible chart to that symbol if needed and does not restore the previous symbol.', {
    symbol: z.string().trim().min(1).describe('Required symbol to quote (e.g., "AAPL", "NASDAQ:AMZN", "ES1!").'),
  }, async ({ symbol }) => {
    try {
      const out = await withTab((deps) => core.getQuote({ symbol, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('depth_get', 'Get order book / DOM (Depth of Market) data for a symbol. Switches the visible chart to the symbol if needed — NOTE: this mutates the visible chart and does NOT restore the previous symbol. Requires the DOM panel to be open in TradingView.', {
    symbol: z.string().describe('Symbol to fetch depth for (e.g., "AAPL", "ES1!", "NYMEX:CL1!")'),
  }, async ({ symbol }) => {
    try {
      const out = await withTab((deps) => core.getDepth({ symbol, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err, { hint: 'Open the DOM panel in TradingView before using this tool.' }); }
  });

  server.tool('data_get_pine_lines', 'Read horizontal price levels drawn by Pine Script indicators (line.new). Returns deduplicated price levels per study. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "Profiler", "NY Levels"). Omit for all.'),
    verbose: z.coerce.boolean().optional().describe('Return raw line data with IDs, coordinates, colors (default false — returns only unique price levels)'),
  }, async ({ study_filter, verbose }) => {
    try {
      const out = await withTab((deps) => core.getPineLines({ study_filter, verbose, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_pine_labels', 'Read text labels drawn by Pine Script indicators (label.new). Returns text and price pairs. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    max_labels: z.coerce.number().optional().describe('Max labels per study (default 50). Set higher if you need all.'),
    verbose: z.coerce.boolean().optional().describe('Return raw label data with IDs, colors, positions (default false — returns only text + price)'),
  }, async ({ study_filter, max_labels, verbose }) => {
    try {
      const out = await withTab((deps) => core.getPineLabels({ study_filter, max_labels, verbose, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_pine_tables', 'Read table data drawn by Pine Script indicators (table.new). Returns formatted text rows per table. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
  }, async ({ study_filter }) => {
    try {
      const out = await withTab((deps) => core.getPineTables({ study_filter, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_pine_boxes', 'Read box/zone boundaries drawn by Pine Script indicators (box.new). Returns deduplicated {high, low} price zones. Use study_filter to target a specific indicator.', {
    study_filter: z.string().optional().describe('Substring to match study name. Omit for all.'),
    verbose: z.coerce.boolean().optional().describe('Return all boxes with IDs and coordinates (default false — returns unique price zones)'),
  }, async ({ study_filter, verbose }) => {
    try {
      const out = await withTab((deps) => core.getPineBoxes({ study_filter, verbose, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_pine_graphics', 'Read all Pine Script graphics (lines, labels, tables, boxes) in ONE call — batches the four data_get_pine_* tools into a single chart query. Use include to narrow, study_filter to target an indicator.', {
    include: z.array(z.enum(['lines', 'labels', 'tables', 'boxes'])).optional().describe('Which graphics to read. Default: all four.'),
    study_filter: z.string().optional().describe('Substring to match study name (e.g., "Profiler"). Omit for all.'),
    max_labels: z.coerce.number().optional().describe('Max labels per study (default 50).'),
  }, async ({ include, study_filter, max_labels }) => {
    try {
      const out = await withTab((deps) => core.getPineGraphics({ include, study_filter, max_labels, _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });

  server.tool('data_get_study_values', 'Get current indicator values from the data window for all visible studies (RSI, MACD, Bollinger Bands, EMAs, custom indicators with plot()).', {}, async () => {
    try {
      const out = await withTab((deps) => core.getStudyValues({ _deps: deps }), { route: 'visible' });
      return jsonResult(out);
    } catch (err) { return fail(err); }
  });
}

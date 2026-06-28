import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerHealthTools } from './tools/health.js';
import { registerChartTools } from './tools/chart.js';
import { registerPineTools } from './tools/pine.js';
import { registerDataTools } from './tools/data.js';
import { registerCaptureTools } from './tools/capture.js';
import { registerDrawingTools } from './tools/drawing.js';
import { registerAlertTools } from './tools/alerts.js';
import { registerBatchTools } from './tools/batch.js';
import { registerReplayTools } from './tools/replay.js';
import { registerIndicatorTools } from './tools/indicators.js';
import { registerWatchlistTools } from './tools/watchlist.js';
import { registerUiTools } from './tools/ui.js';
import { registerPaneTools } from './tools/pane.js';
import { registerTabTools } from './tools/tab.js';
import { registerNewsTools } from './tools/news.js';
import { registerOptionsTools } from './tools/options.js';
import { EXTENDED_TOOLS } from './tools/_groups.js';
import { startDiagnostics } from './core/diagnostics.js';
import { ensurePrimarySlot, isPoolDisabled, getPool } from './connection.js';

const tvMcpExtended = process.env.TV_MCP_EXTENDED;
if (tvMcpExtended !== undefined && tvMcpExtended !== '1' && tvMcpExtended !== '0' && tvMcpExtended !== '') {
  process.stderr.write(`⚠  TV_MCP_EXTENDED="${tvMcpExtended}" is not recognized. Valid: "1" to enable extended mode. Defaulting to read-only.\n`);
}
const extendedMode = tvMcpExtended === '1';
const toolCount = extendedMode ? 88 : (88 - EXTENDED_TOOLS.size); // 43 or 88

const defaultInstructions = `TradingView MCP — ${toolCount} tools for reading and controlling a live TradingView Desktop chart.

TOOL SELECTION GUIDE — use this to pick the right tool:

Reading your chart:
- chart_get_state → get symbol, timeframe, all indicator names + entity IDs (call first)
- data_get_study_values → get current numeric values from ALL visible indicators (RSI, MACD, BB, EMA, etc.)
- quote_get → get real-time price snapshot (last, OHLC, volume)
- data_get_ohlcv → get price bars. ALWAYS pass summary=true unless you need individual bars

Reading custom Pine indicator output (line.new/label.new/table.new/box.new drawings):
- data_get_pine_lines → horizontal price levels from custom indicators (deduplicated, sorted)
- data_get_pine_labels → text annotations with prices ("PDH 24550", "Bias Long", etc.)
- data_get_pine_tables → table data as formatted rows (session stats, analytics dashboards)
- data_get_pine_boxes → price zones as {high, low} pairs
- ALWAYS pass study_filter to target a specific indicator by name (e.g., study_filter="Profiler")
- Indicators must be VISIBLE on chart for these to work

Changing the chart:
- chart_set_symbol, chart_set_timeframe, chart_set_type → change ticker/resolution/style
- chart_manage_indicator → add/remove studies. USE FULL NAMES: "Relative Strength Index" not "RSI"
- chart_scroll_to_date → jump to a date (ISO format)

Screenshots: capture_screenshot → regions: "full", "chart", "strategy_tester"
Launch: tv_launch → auto-detect and start TradingView with CDP on any platform

CONTEXT MANAGEMENT:
- ALWAYS use summary=true on data_get_ohlcv
- ALWAYS use study_filter on pine tools when you know which indicator you want
- NEVER use verbose=true unless user specifically asks for raw data
- Prefer capture_screenshot for visual context over pulling large datasets
- Call chart_get_state ONCE at start, reuse entity IDs

Run with TV_MCP_EXTENDED=1 to unlock Pine Script, replay, drawing, alerts, UI automation, and batch tools (88 total).`;

const extendedInstructions = `TradingView MCP — ${toolCount} tools for reading and controlling a live TradingView Desktop chart.

TOOL SELECTION GUIDE — use this to pick the right tool:

Reading your chart:
- chart_get_state → get symbol, timeframe, all indicator names + entity IDs (call first)
- data_get_study_values → get current numeric values from ALL visible indicators (RSI, MACD, BB, EMA, etc.)
- quote_get → get real-time price snapshot (last, OHLC, volume)
- data_get_ohlcv → get price bars. ALWAYS pass summary=true unless you need individual bars

Reading custom Pine indicator output (line.new/label.new/table.new/box.new drawings):
- data_get_pine_lines → horizontal price levels from custom indicators (deduplicated, sorted)
- data_get_pine_labels → text annotations with prices ("PDH 24550", "Bias Long", etc.)
- data_get_pine_tables → table data as formatted rows (session stats, analytics dashboards)
- data_get_pine_boxes → price zones as {high, low} pairs
- ALWAYS pass study_filter to target a specific indicator by name (e.g., study_filter="Profiler")
- Indicators must be VISIBLE on chart for these to work

Changing the chart:
- chart_set_symbol, chart_set_timeframe, chart_set_type → change ticker/resolution/style
- chart_manage_indicator → add/remove studies. USE FULL NAMES: "Relative Strength Index" not "RSI"
- chart_scroll_to_date → jump to a date (ISO format)
- indicator_set_inputs → change indicator settings (length, source, etc.)

Pine Script development:
- pine_set_source → inject code, pine_smart_compile → compile + check errors
- pine_get_errors → read errors, pine_get_console → read log output
- WARNING: pine_get_source can return 200KB+ for complex scripts — avoid unless editing

Screenshots: capture_screenshot → regions: "full", "chart", "strategy_tester"
Replay: replay_start → replay_step → replay_trade → replay_status → replay_stop
Batch: batch_run → run action across multiple symbols/timeframes
Drawing: draw_shape → horizontal_line, trend_line, rectangle, text
Alerts: alert_create, alert_list, alert_delete
Launch: tv_launch → auto-detect and start TradingView with CDP on any platform
Panes: pane_list, pane_set_layout (s, 2h, 2v, 4, 6, 8), pane_focus, pane_set_symbol
Tabs: tab_list, tab_new, tab_close, tab_switch

CONTEXT MANAGEMENT:
- ALWAYS use summary=true on data_get_ohlcv
- ALWAYS use study_filter on pine tools when you know which indicator you want
- NEVER use verbose=true unless user specifically asks for raw data
- Prefer capture_screenshot for visual context over pulling large datasets
- Call chart_get_state ONCE at start, reuse entity IDs`;

const server = new McpServer(
  {
    name: 'tradingview',
    version: '2.0.0',
    description: 'AI-assisted TradingView chart analysis and Pine Script development via Chrome DevTools Protocol',
  },
  {
    instructions: extendedMode ? extendedInstructions : defaultInstructions,
  }
);

// In extended mode, register everything. In default mode, gate EXTENDED_TOOLS out.
const registrar = extendedMode ? server : {
  tool(name, ...rest) {
    return EXTENDED_TOOLS.has(name) ? undefined : server.tool(name, ...rest);
  },
};

// Register all tool groups (registrar gates EXTENDED_TOOLS out in default mode)
registerHealthTools(registrar);
registerChartTools(registrar);
registerPineTools(registrar);
registerDataTools(registrar);
registerCaptureTools(registrar);
registerDrawingTools(registrar);
registerAlertTools(registrar);
registerBatchTools(registrar);
registerReplayTools(registrar);
registerIndicatorTools(registrar);
registerWatchlistTools(registrar);
registerUiTools(registrar);
registerPaneTools(registrar);
registerTabTools(registrar);
registerNewsTools(registrar);
registerOptionsTools(registrar);
startDiagnostics();

// Startup notice (stderr so it doesn't interfere with MCP stdio protocol)
process.stderr.write('⚠  tradingview-mcp  |  Unofficial tool. Not affiliated with TradingView Inc. or Anthropic.\n');
process.stderr.write('   Ensure your usage complies with TradingView\'s Terms of Use.\n\n');

// Warm the primary (visible) tab in the BACKGROUND so the first request doesn't pay
// adopt-or-create cost — but don't block server startup (ensurePrimarySlot retries for
// ~15s when TradingView is down). If it fails, the first real tool call surfaces CDP_DOWN.
ensurePrimarySlot().catch((err) => {
  process.stderr.write(`⚠  primary tab warmup deferred: ${err?.message || err}\n`);
});

// Graceful shutdown: drain the pool (close self-created tabs, never the user's) on signal.
let _shuttingDown = false;
async function shutdown(signal) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  try {
    if (!isPoolDisabled()) await getPool().drain();
  } catch { /* best-effort */ }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Start stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);

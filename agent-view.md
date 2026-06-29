# Agent View — TradingView MCP

What an AI agent sees when connected to this MCP server: tool names, descriptions, and input schemas exactly as registered.

## Connection

```
Claude Code ←→ MCP Server (stdio) ←→ CDP (localhost:9222) ←→ TradingView Desktop (Electron)
```

TradingView Desktop must be running with `--remote-debugging-port=9222`.

## Tool Counts

| Mode | How to enable | Tools |
|------|--------------|-------|
| **Default** | `npm start` | **22** |
| **Extended** | `TV_MCP_EXTENDED=1 npm start` | **99** (22 + 77) |

Default exposes the REST-first read surface (market data, news, fundamentals). Extended adds chart control, Pine Script, drawings, alerts, replay, UI automation, and data readers.

---

## Default Tools (22)

### Connection

#### `tv_health_check`
Check CDP connection to TradingView and return current chart state.
_(no parameters)_

#### `tv_launch`
Launch TradingView Desktop with Chrome DevTools Protocol enabled. Auto-detects install on Mac, Windows, Linux.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `port` | number | no | CDP port (default 9222) |
| `kill_existing` | boolean | no | Kill existing TradingView instances first (default true) |

---

### Price & Quotes

#### `quote_get`
Get real-time quote data for a symbol (price, OHLC, volume).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | no | Symbol to quote (blank = current chart symbol) |

#### `fetch_ohlcv`
Fetch OHLCV for any symbol+timeframe in one call. Switches the chart to the requested symbol/timeframe, then returns bars. **NOTE: mutates the chart and does NOT restore the previous symbol/timeframe.**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"AAPL"`, `"ES1!"`, `"NYMEX:CL1!"`) |
| `timeframe` | string | no | Resolution (e.g., `"1"`, `"5"`, `"60"`, `"D"`, `"W"`). Omit to keep current. |
| `count` | number | no | Number of bars (default 100, capped at 500) |
| `summary` | boolean | no | Return compact summary stats instead of all bars (recommended) |

#### `market_status`
Get market session status for a symbol (open / closed / pre_market / post_market) plus session metadata. **NOTE: switches to the symbol, does NOT restore previous.**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"AAPL"`, `"ES1!"`) |

---

### Symbol Search

#### `symbol_search`
Search for symbols by name or keyword (anonymous REST).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | **yes** | Search query (e.g., `"AAPL"`, `"crude oil"`, `"ES"`) |
| `type` | string | no | Filter: `"stock"`, `"futures"`, `"crypto"`, `"forex"`, `"option"` |

#### `symbol_search_live`
Search symbols using the logged-in TradingView session (in-app searchSymbols API). Complements `symbol_search`.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | **yes** | Search query |

#### `symbol_info`
Get detailed metadata about a symbol (name, exchange, type, description). **NOTE: switches to the symbol, does NOT restore previous.**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"AAPL"`, `"ES1!"`) |

---

### Watchlist

#### `watchlist_get`
Get all symbols from the current TradingView watchlist with last price, change, and change%.
_(no parameters)_

---

### News

#### `news_get_headlines`
Get recent news headlines for the current or given symbol. Returns id, title, provider, published, urgency.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | no | Symbol pro_name (e.g., `"NASDAQ:AMZN"`). Omit = current chart symbol. |
| `limit` | number | no | Max headlines (1-50, default 25) |

#### `news_get_story`
Get the full body text of a news story by its headline id.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **yes** | Story id from `news_get_headlines` |

---

### Fundamentals & Market Data (REST, no chart required)

#### `financials_get`
Get fundamental financials (revenue, gross profit, net income, EBITDA, EBIT, total assets/liabilities/equity, P/E TTM, P/B, P/CF, EPS basic TTM).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"NASDAQ:AMZN"`, `"AAPL"`, `"NYSE:JPM"`) |
| `fields` | string | no | Comma-separated scanner fields to override defaults |

#### `forecast_get`
Get analyst forecast & consensus: price targets (avg/high/low/median), recommendation breakdown (buy/hold/sell), recommendation label (Strong Buy..Strong Sell), next-quarter EPS/revenue estimates, earnings dates.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"NASDAQ:AMZN"`, `"AAPL"`) |
| `fields` | string | no | Comma-separated scanner fields to override defaults |

#### `technicals_get`
Get TradingView's aggregate technical-analysis rating. Returns recommendation (overall), oscillators, and moving_averages on a ±1 scale: >0.5 Strong Buy, >0.1 Buy, -0.1..0.1 Neutral, <-0.1 Sell, <-0.5 Strong Sell.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Exchange-prefixed symbol (e.g., `"NASDAQ:AMZN"`, `"BINANCE:BTCUSDT"`) |
| `columns` | string[] | no | Scanner columns to request (default: Recommend.All, Recommend.MA, Recommend.Other) |
| `interval` | enum | no | `"1h"` \| `"4h"` \| `"1D"` \| `"1W"` \| `"1M"` (default: daily) |

#### `etf_search`
Search US-listed ETFs/funds. No query = largest funds by AUM. Each result includes name, AUM, expense ratio, asset class, focus, 3Y NAV return, 1M fund flows. Works without TradingView Desktop.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | no | Name or ticker phrase (e.g., `"S&P 500"`, `"VOO"`, `"semiconductor"`). Omit = top AUM. |
| `limit` | number | no | Max ETFs to return (default 50, clamped 1-200) |

#### `etf_get`
Get detailed data for a single ETF by exact symbol. Throws if symbol is not a known fund.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Exact ETF symbol with exchange prefix (e.g., `"AMEX:VOO"`, `"NASDAQ:QQQ"`) |

#### `bond_search`
Search global bonds via TradingView's public bond scanner. Returns symbol, name, coupon, yield-to-maturity (decimal), maturity date, close, change. Sorted by yield (highest first).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | no | Search phrase (e.g., `"Treasury"`, `"Apple"`) |
| `maturity_after` | string | no | Only bonds maturing after this date (YYYY-MM-DD) |
| `maturity_before` | string | no | Only bonds maturing before this date (YYYY-MM-DD) |
| `min_yield` | number | no | Minimum YTM as decimal (e.g., `0.04` = 4%) |
| `max_yield` | number | no | Maximum YTM as decimal (e.g., `0.08` = 8%) |
| `limit` | number | no | Max results (1-200, default 50) |

---

### Community

#### `community_get_ideas`
Get published community trade ideas for a symbol. Returns id, title, description, author, created_at, chart_url, views, likes, comments.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"NASDAQ:AMZN"`) |
| `page` | number | no | Page number (default 1) |
| `sort` | enum | no | `"recent"` (default) \| `"popular"` \| `"trending"` |

#### `community_get_minds`
Get short social posts ("Minds") for a symbol. Cursor-paginated.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"NASDAQ:AMZN"`) |
| `limit` | number | no | Max posts (1-50, default 20) |
| `cursor` | string | no | Opaque cursor from previous response's `next_cursor` |

#### `community_get_scripts`
Get community Pine scripts for a symbol. Optional keyword search.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"NASDAQ:AMZN"`) |
| `query` | string | no | Keyword search filter |
| `page` | number | no | Page number (default 1) |

---

### Documents

#### `documents_list`
List corporate/financial documents (quarterly/annual reports, earnings releases, call transcripts, slides, press releases). Returns id, title, category, fiscal period/year, reported date, provider, form, view_ids.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol pro_name (e.g., `"NASDAQ:AMZN"`) |
| `categories` | enum[] | no | Filter: `quarterly_report` \| `annual_report` \| `earnings_release` \| `call_transcript` \| `event_transcript` \| `slides` \| `press_release` |
| `lang` | string | no | Language code (default `"en"`) |
| `limit` | number | no | Max documents (1-100, default 20) |

#### `documents_get_file`
Fetch a single document by its view_id (from `documents_list`). Requires a TradingView documents entitlement; returns `file_available: false` on auth failure instead of throwing.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `view_id` | string | **yes** | View id from `documents_list` (e.g., `"urn:report:...-abc123"`) |

---

## Extended Tools (77) — requires `TV_MCP_EXTENDED=1`

### Diagnostics

#### `tv_discover`
Report which known TradingView API paths are available and their methods.
_(no parameters)_

#### `tv_ui_state`
Get current UI state: which panels are open, what buttons are visible/enabled/disabled.
_(no parameters)_

---

### Chart State & Control

#### `chart_get_state`
Get current chart state (symbol, timeframe, chart type, all indicators with entity IDs).
_(no parameters)_

#### `chart_set_symbol`
Change the chart symbol.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"BTCUSD"`, `"AAPL"`, `"ES1!"`, `"NYMEX:CL1!"`) |

#### `chart_set_timeframe`
Change the chart timeframe/resolution.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `timeframe` | string | **yes** | Resolution (e.g., `"1"`, `"5"`, `"15"`, `"60"`, `"D"`, `"W"`, `"M"`) |

#### `chart_set_type`
Change chart type.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `chart_type` | string | **yes** | Name or number: Bars(0), Candles(1), Line(2), Area(3), Renko(4), Kagi(5), PointAndFigure(6), LineBreak(7), HeikinAshi(8), HollowCandles(9) |

#### `chart_manage_indicator`
Add or remove an indicator/study on the chart.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | enum | **yes** | `"add"` \| `"remove"` |
| `indicator` | string | **yes** | **Full name required**: `"Relative Strength Index"`, `"MACD"`, `"Volume"`, `"Moving Average"`, `"Bollinger Bands"`, `"Moving Average Exponential"`. Short names (RSI/EMA) do NOT work. |
| `entity_id` | string | no | Entity ID to remove (from `chart_get_state`). Required for remove. |
| `inputs` | string | no | JSON string of input overrides (e.g., `'{"length": 20}'`) |

#### `chart_get_visible_range`
Get the visible date range (unix timestamps) and bar count on the chart.
_(no parameters)_

#### `chart_set_visible_range`
Zoom the chart to a specific date range. Accepts unix timestamps (seconds) or ISO date strings.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | number \| string | **yes** | Start: unix timestamp or ISO date (e.g., `"2025-01-15"`) |
| `to` | number \| string | **yes** | End: unix timestamp or ISO date |

#### `chart_scroll_to_date`
Jump the chart view to center on a specific date.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | **yes** | ISO date string (e.g., `"2024-01-15"`) or unix timestamp as string |

#### `chart_report`
Full chart analysis in one call — batches state, study values, quote, pine graphics, OHLCV summary, and optional screenshot. Per-section error isolation; response capped at 50KB.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `include` | enum[] | no | Sections: `state` \| `study_values` \| `pine_lines` \| `pine_labels` \| `pine_tables` \| `pine_boxes` \| `quote` \| `ohlcv` \| `screenshot`. Default: `["state","study_values","quote"]`. `ohlcv` and `screenshot` are expensive. |
| `study_filter` | string | no | Substring to match study name for pine_* sections |
| `ohlcv_count` | number | no | Bars for ohlcv section (default 100) |
| `screenshot_region` | enum | no | `"full"` \| `"chart"` \| `"strategy_tester"` (default `"chart"`) |

---

### Screenshot

#### `capture_screenshot`
Take a screenshot of the TradingView chart. Saves to `screenshots/` with timestamp; returns file path.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `region` | string | no | `"full"` \| `"chart"` \| `"strategy_tester"` (default `"full"`) |
| `filename` | string | no | Custom filename (without extension) |
| `method` | string | no | `"cdp"` (Page.captureScreenshot) \| `"api"` (chartWidgetCollection.takeScreenshot) (default `"cdp"`) |

---

### Data Readers

#### `data_get_ohlcv`
Get OHLCV bar data from the chart. Use `summary=true` for compact stats (saves context).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `count` | number | no | Number of bars (max 500, default 100) |
| `summary` | boolean | no | Return summary stats (high, low, open, close, avg volume, range) instead of all bars |

#### `data_get_study_values`
Get current indicator values from the data window for all visible studies (RSI, MACD, Bollinger Bands, EMAs, custom indicators with `plot()`).
_(no parameters)_

#### `data_get_pine_lines`
Read horizontal price levels drawn by Pine Script indicators (`line.new`). Returns deduplicated price levels per study.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `study_filter` | string | no | Substring to match study name (e.g., `"Profiler"`, `"NY Levels"`). Omit = all. |
| `verbose` | boolean | no | Return raw line data with IDs, coordinates, colors (default false = unique price levels only) |

#### `data_get_pine_labels`
Read text labels drawn by Pine Script indicators (`label.new`). Returns text and price pairs.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `study_filter` | string | no | Substring to match study name. Omit = all. |
| `max_labels` | number | no | Max labels per study (default 50) |
| `verbose` | boolean | no | Return raw label data with IDs, colors, positions (default false = text+price only) |

#### `data_get_pine_tables`
Read table data drawn by Pine Script indicators (`table.new`). Returns formatted text rows per table.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `study_filter` | string | no | Substring to match study name. Omit = all. |

#### `data_get_pine_boxes`
Read box/zone boundaries drawn by Pine Script indicators (`box.new`). Returns deduplicated `{high, low}` price zones.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `study_filter` | string | no | Substring to match study name. Omit = all. |
| `verbose` | boolean | no | Return all boxes with IDs and coordinates (default false = unique price zones only) |

#### `data_get_pine_graphics`
Read all Pine Script graphics (lines, labels, tables, boxes) in ONE call — batches the four `data_get_pine_*` tools into a single chart query.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `include` | enum[] | no | Which graphics: `"lines"` \| `"labels"` \| `"tables"` \| `"boxes"`. Default: all four. |
| `study_filter` | string | no | Substring to match study name |
| `max_labels` | number | no | Max labels per study (default 50) |

#### `data_get_indicator`
Get indicator/study info and input values.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_id` | string | **yes** | Study entity ID (from `chart_get_state`) |

#### `data_get_strategy_results`
Get strategy performance metrics from Strategy Tester.
_(no parameters)_

#### `data_get_trades`
Get trade list from Strategy Tester.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `max_trades` | number | no | Maximum trades to return |

#### `data_get_equity`
Get equity curve data from Strategy Tester.
_(no parameters)_

#### `depth_get`
Get order book / DOM data for a symbol. **Requires the DOM panel open in TradingView. NOTE: switches the visible chart, does NOT restore previous.**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"AAPL"`, `"ES1!"`) |

#### `options_search`
Search options contracts for an underlying symbol. Returns deduplicated contracts sorted by strike.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `underlying` | string | **yes** | Underlying symbol (e.g., `"AAPL"`, `"SPY"`, `"TSLA"`) |
| `expiry_after` | string | no | Only contracts expiring on/after this date (YYYY-MM-DD) |
| `expiry_before` | string | no | Only contracts expiring on/before this date (YYYY-MM-DD) |
| `contract_type` | enum | no | `"call"` \| `"put"` |
| `strike_min` | number | no | Minimum strike price (inclusive) |
| `strike_max` | number | no | Maximum strike price (inclusive) |
| `limit` | number | no | Max contracts (default 50, capped 500) |

---

### Drawing

#### `draw_shape`
Draw a shape/line on the chart.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `shape` | string | **yes** | `"horizontal_line"` \| `"vertical_line"` \| `"trend_line"` \| `"rectangle"` \| `"text"` |
| `point` | object | **yes** | `{ time: unix_timestamp, price: number }` |
| `point2` | object | no | Second point for two-point shapes (trend_line, rectangle): `{ time, price }` |
| `text` | string | no | Text content for text shapes |
| `overrides` | string | no | JSON string of style overrides (e.g., `'{"linecolor": "#ff0000", "linewidth": 2}'`) |

#### `draw_list`
List all shapes/drawings on the chart.
_(no parameters)_

#### `draw_remove_one`
Remove a specific drawing by entity ID.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_id` | string | **yes** | Entity ID from `draw_list` |

#### `draw_clear`
Remove all drawings from the chart.
_(no parameters)_

#### `draw_get_properties`
Get properties and points of a specific drawing.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_id` | string | **yes** | Entity ID from `draw_list` |

---

### Alerts

#### `alert_create`
Create a price alert via the TradingView alert dialog.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `condition` | string | **yes** | Alert condition: `"crossing"` \| `"greater_than"` \| `"less_than"` |
| `price` | number | **yes** | Price level for the alert |
| `message` | string | no | Alert message |

#### `alert_list`
List active alerts.
_(no parameters)_

#### `alert_delete`
Delete all alerts or open context menu for deletion.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `delete_all` | boolean | no | Delete all alerts |

---

### Batch

#### `batch_run`
Run an action across multiple symbols and/or timeframes.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbols` | string[] | **yes** | Array of symbols (e.g., `["BTCUSD", "ETHUSD", "AAPL"]`) |
| `timeframes` | string[] | no | Array of timeframes (e.g., `["D", "60", "15"]`) |
| `action` | string | **yes** | `"screenshot"` \| `"get_ohlcv"` \| `"get_strategy_results"` |
| `delay_ms` | number | no | Delay between iterations in ms (default 2000) |
| `ohlcv_count` | number | no | Bar count for `get_ohlcv` action (default 100) |

---

### Replay

#### `replay_start`
Start bar replay mode.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | no | Date to start from (YYYY-MM-DD). Omit = first available date. |

#### `replay_step`
Advance one bar in replay mode.
_(no parameters)_

#### `replay_autoplay`
Toggle autoplay in replay mode.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `speed` | number | no | Delay per bar in ms: `100`, `143`, `200`, `300`, `1000`, `2000`, `3000`, `5000`, `10000`. Omit = toggle only. |

#### `replay_stop`
Stop replay and return to realtime.
_(no parameters)_

#### `replay_trade`
Execute a trade action in replay mode.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `action` | string | **yes** | `"buy"` \| `"sell"` \| `"close"` |

#### `replay_status`
Get current replay mode status.
_(no parameters)_

#### `replay_run`
Run a full replay session in one call: start, autoplay forward, poll until N bars elapse, then optionally stop. Wall-clock cost ≈ steps × speed_ms + poll overhead.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `date` | string | no | Start date (YYYY-MM-DD). Omit = first available date. |
| `steps` | number | no | Number of bars to advance (default 50, capped 500) |
| `speed_ms` | number | no | Autoplay delay per bar in ms (default 200). Must be one of: 100, 143, 200, 300, 1000, 2000, 3000, 5000, 10000. |
| `stop_after` | boolean | no | Stop replay and return to realtime after the run (default false) |

---

### Indicator Controls

#### `indicator_set_inputs`
Change indicator/study input values (length, source, period, etc.).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_id` | string | **yes** | Study entity ID (from `chart_get_state`) |
| `inputs` | string | **yes** | JSON string of input overrides, e.g. `'{"length": 50, "source": "close"}'` |

#### `indicator_toggle_visibility`
Show or hide an indicator/study on the chart.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `entity_id` | string | **yes** | Study entity ID (from `chart_get_state`) |
| `visible` | boolean | **yes** | `true` to show, `false` to hide |

---

### Watchlist

#### `watchlist_add`
Add a symbol to the TradingView watchlist.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `symbol` | string | **yes** | Symbol (e.g., `"AAPL"`, `"BTCUSD"`, `"ES1!"`) |

---

### Pine Script

#### `pine_set_source`
Set Pine Script source code in the editor.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | **yes** | Pine Script source code to inject |

#### `pine_smart_compile`
Intelligent compile: detects button, compiles, checks errors, reports study changes.
_(no parameters)_

#### `pine_compile`
Compile / add the current Pine Script to the chart.
_(no parameters)_

#### `pine_get_errors`
Get Pine Script compilation errors from Monaco markers.
_(no parameters)_

#### `pine_get_console`
Read Pine Script console/log output (compile messages, `log.info()`, errors).
_(no parameters)_

#### `pine_get_source`
Get current Pine Script source code from the editor. **WARNING: can return 200KB+ for complex scripts.**
_(no parameters)_

#### `pine_save`
Save the current Pine Script (Ctrl+S).
_(no parameters)_

#### `pine_new`
Create a new blank Pine Script.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | enum | **yes** | `"indicator"` \| `"strategy"` \| `"library"` |

#### `pine_open`
Open a saved Pine Script by name (case-insensitive match).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **yes** | Name of the saved script |

#### `pine_list_scripts`
List saved Pine Scripts.
_(no parameters)_

#### `pine_analyze`
Run static analysis on Pine Script code WITHOUT compiling — catches array out-of-bounds, unguarded `array.first()`/`last()`, bad loop bounds, implicit bool casts. **Works offline, no chart needed.**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | **yes** | Pine Script source code to analyze |

#### `pine_check`
Compile Pine Script via TradingView's server API without needing the chart open. Returns compilation errors/warnings.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | **yes** | Pine Script source code to compile/validate |

#### `pine_deploy`
Deploy a Pine script end-to-end: opens editor, sets source, compiles, reads errors + console, optionally saves.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `source` | string | **yes** | Pine Script source code to deploy |
| `save_name` | string | no | If provided, save the script after compiling |

---

### UI Automation

#### `ui_open_panel`
Open, close, or toggle TradingView panels.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `panel` | enum | **yes** | `"pine-editor"` \| `"strategy-tester"` \| `"watchlist"` \| `"alerts"` \| `"trading"` |
| `action` | enum | **yes** | `"open"` \| `"close"` \| `"toggle"` |

#### `ui_click`
Click a UI element by aria-label, data-name, text content, or class substring.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `by` | enum | **yes** | `"aria-label"` \| `"data-name"` \| `"text"` \| `"class-contains"` |
| `value` | string | **yes** | Value to match against the chosen selector strategy |

#### `ui_keyboard`
Press keyboard keys or shortcuts.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `key` | string | **yes** | Key (e.g., `"Enter"`, `"Escape"`, `"Tab"`, `"a"`, `"ArrowUp"`) |
| `modifiers` | enum[] | no | `"ctrl"` \| `"alt"` \| `"shift"` \| `"meta"` |

#### `ui_type_text`
Type text into the currently focused input/textarea element.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | **yes** | Text to type |

#### `ui_hover`
Hover over a UI element.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `by` | enum | **yes** | `"aria-label"` \| `"data-name"` \| `"text"` \| `"class-contains"` |
| `value` | string | **yes** | Value to match |

#### `ui_scroll`
Scroll the chart or page.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `direction` | enum | **yes** | `"up"` \| `"down"` \| `"left"` \| `"right"` |
| `amount` | number | no | Scroll amount in pixels (default 300) |

#### `ui_mouse_click`
Click at specific x,y coordinates on the TradingView window.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `x` | number | **yes** | X coordinate (pixels from left) |
| `y` | number | **yes** | Y coordinate (pixels from top) |
| `button` | enum | no | `"left"` \| `"right"` \| `"middle"` (default `"left"`) |
| `double_click` | boolean | no | Double click (default false) |

#### `ui_find_element`
Find UI elements by text, aria-label, or CSS selector and return their positions.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | **yes** | Text content, aria-label value, or CSS selector |
| `strategy` | enum | no | `"text"` \| `"aria-label"` \| `"css"` (default `"text"`) |

#### `ui_evaluate`
Execute JavaScript code in the TradingView page context for advanced automation.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `expression` | string | **yes** | JavaScript expression to evaluate. Wrap in IIFE for complex logic. |

#### `ui_fullscreen`
Toggle TradingView fullscreen mode.
_(no parameters)_

#### `layout_list`
List saved chart layouts.
_(no parameters)_

#### `layout_switch`
Switch to a saved chart layout by name or ID.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | **yes** | Name or ID of the layout to switch to |

---

### Pane Management

#### `pane_list`
List all chart panes in the current layout with their symbols and active state.
_(no parameters)_

#### `pane_set_layout`
Change the chart grid layout.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `layout` | string | **yes** | Layout code: `s` (single), `2h`, `2v`, `2-1`, `1-2`, `3h`, `3v`, `4` (2×2), `6`, `8`. Also accepts: `single`, `2x1`, `1x2`, `2x2`, `quad`. |

#### `pane_focus`
Focus a specific chart pane by index (0-based).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `index` | number | **yes** | Pane index (0-based, from `pane_list`) |

#### `pane_set_symbol`
Set the symbol on a specific pane.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `index` | number | **yes** | Pane index (0-based) |
| `symbol` | string | **yes** | Symbol (e.g., `"NQ1!"`, `"ES1!"`, `"AAPL"`) |

---

### Tab Management

#### `tab_list`
List all open TradingView chart tabs.
_(no parameters)_

#### `tab_new`
Open a new chart tab.
_(no parameters)_

#### `tab_close`
Close the current chart tab.
_(no parameters)_

#### `tab_switch`
Switch to a chart tab by index.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `index` | number | **yes** | Tab index (0-based, from `tab_list`) |

---

## Summary

| Category | Default | Extended | Total |
|----------|--------:|--------:|------:|
| Connection | 2 | 3 | 5 |
| Price & Quotes | 3 | 0 | 3 |
| Symbol Search | 3 | 0 | 3 |
| Data Readers | 0 | 13 | 13 |
| Chart Control | 0 | 9 | 9 |
| Pine Script | 0 | 13 | 13 |
| Drawing | 0 | 5 | 5 |
| Alerts | 0 | 3 | 3 |
| Replay | 0 | 7 | 7 |
| Batch | 0 | 1 | 1 |
| Watchlist | 1 | 1 | 2 |
| News | 2 | 0 | 2 |
| Fundamentals | 4 | 0 | 4 |
| ETF | 2 | 0 | 2 |
| Bonds | 1 | 0 | 1 |
| Community | 3 | 0 | 3 |
| Documents | 2 | 0 | 2 |
| Technicals | 1 | 0 | 1 |
| UI Automation | 0 | 12 | 12 |
| Pane Management | 0 | 4 | 4 |
| Tab Management | 0 | 4 | 4 |
| Options | 0 | 1 | 1 |
| Indicator Controls | 0 | 2 | 2 |
| Screenshot | 0 | 1 | 1 |
| **Total** | **24** | **79** | **103** |

> Note: `tv_health_check` and `tv_launch` are in Connection; `symbol_info`, `symbol_search`, `symbol_search_live` are in Symbol Search; `quote_get`, `fetch_ohlcv`, `market_status` are in Price & Quotes — counted to match categories above. Raw file count: **99 tools** (22 default + 77 extended).

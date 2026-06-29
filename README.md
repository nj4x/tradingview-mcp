# TradingView MCP Bridge

Personal AI assistant for your TradingView Desktop charts. Connects Claude Code to your locally running TradingView app via Chrome DevTools Protocol for AI-assisted chart analysis, Pine Script development, and workflow automation.

> [!WARNING]
> **This tool is not affiliated with, endorsed by, or associated with TradingView Inc.** It interacts with your locally running TradingView Desktop application via Chrome DevTools Protocol. Review the [Disclaimer](#disclaimer) before use.

> [!IMPORTANT]
> **Requires a valid TradingView subscription.** This tool does not bypass or circumvent any TradingView paywall or access control. It reads from and controls the TradingView Desktop app already running on your machine.

> [!NOTE]
> **All data processing occurs locally on your machine.** No TradingView data is transmitted, stored, or redistributed externally by this tool.

> [!CAUTION]
> This tool accesses undocumented internal TradingView APIs via the Electron debug interface. These can change or break without notice in any TradingView update. Pin your TradingView Desktop version if stability matters to you.

## How It Works (and why it's safe to run)

This tool does not connect to TradingView's servers, modify any TradingView files, or intercept any network traffic. It communicates exclusively with your locally running TradingView Desktop instance via Chrome DevTools Protocol (CDP) — a standard debugging interface built into all Chromium/Electron applications by Google, including VS Code, Slack, and Discord.

The debug port is disabled by default and must be explicitly enabled by you using a standard Chromium flag (`--remote-debugging-port=9222`). Nothing happens without that deliberate step.

## What This Tool Does Not Do

- Connect to TradingView's servers or APIs
- Store, transmit, or redistribute any market data
- Work without a valid TradingView subscription and installed Desktop app
- Bypass any TradingView paywall or access restriction
- Execute real trades (chart interaction only)
- Work if TradingView changes their internal Electron structure

## Research Context

This project explores an open research question: **how can LLM-based agents interact with professional trading interfaces to support human decision-making?**

Specifically it investigates:

- How structured tool APIs (MCP) can bridge LLMs and stateful desktop financial applications
- What latency, context, and reliability constraints emerge when an agent operates on live chart data
- How agents handle ambiguous financial UI state (e.g. interpreting Pine Script output, reading indicator tables)
- Whether natural language is an effective interface for chart navigation and Pine Script development
- The failure modes of LLM agents operating in real-time data environments

This is not a trading bot. It is an interface layer that makes a trading application legible to an LLM agent, allowing researchers and developers to study human-AI collaboration in financial workflows.

See [RESEARCH.md](RESEARCH.md) for open questions, findings, and related work.

## Prerequisites

- **TradingView Desktop app** (paid subscription required for real-time data)
- **Node.js 18+**
- **Claude Code** with MCP support
- **macOS, Windows, or Linux**

## What It Does

Gives your AI assistant eyes and hands on your own chart:

- **Pine Script development** — write, inject, compile, debug, and iterate on scripts with AI assistance
- **Chart navigation** — change symbols, timeframes, zoom to dates, add/remove indicators
- **Visual analysis** — read your chart's indicator values, price levels, and annotations
- **Draw on charts** — trend lines, horizontal lines, rectangles, text annotations
- **Manage alerts** — create, list, and delete price alerts
- **Replay practice** — step through historical bars, practice entries/exits
- **Screenshots** — capture chart state for AI visual analysis
- **Multi-pane layouts** — set up 2x2, 3x1, etc. grids with different symbols per pane
- **Launch TradingView** — auto-detect and launch with debug mode from any platform

## Install with Claude Code

Paste this into Claude Code and it will handle the rest:

> Install the TradingView MCP server. Clone https://github.com/tradesdontlie/tradingview-mcp.git, run npm install, add it to my MCP config at ~/.claude/.mcp.json, and launch TradingView with the debug port. Then verify the connection with tv_health_check.

Or follow the manual steps below.

## Quick Start

### 1. Install

```bash
git clone https://github.com/tradesdontlie/tradingview-mcp.git
cd tradingview-mcp
npm install
```

### 2. Launch TradingView with CDP

TradingView Desktop must be running with Chrome DevTools Protocol enabled on port 9222.

**Mac:**
```bash
./scripts/launch_tv_debug_mac.sh
```

**Windows:**
```bash
scripts\launch_tv_debug.bat
```

**Linux:**
```bash
./scripts/launch_tv_debug_linux.sh
```

**Or launch manually on any platform:**
```bash
/path/to/TradingView --remote-debugging-port=9222
```

**Or use the MCP tool** (auto-detects your install):
> "Use tv_launch to start TradingView in debug mode"

### 3. Add to Claude Code

Add to your Claude Code MCP config (`~/.claude/.mcp.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/path/to/tradingview-mcp/src/server.js"]
    }
  }
}
```

Replace `/path/to/tradingview-mcp` with your actual path.

### 4. Verify

Ask Claude: *"Use tv_health_check to verify TradingView is connected"*

## How Claude Knows Which Tool to Use

Claude reads [`CLAUDE.md`](CLAUDE.md) automatically when working in this project. It contains a complete decision tree:

| You say... | Claude uses... |
|------------|---------------|
| "What's on my chart?" | `chart_get_state` → `data_get_study_values` → `quote_get` |
| "What levels are showing?" | `data_get_pine_lines` → `data_get_pine_labels` |
| "Read the session table" | `data_get_pine_tables` with `study_filter` |
| "Give me a full analysis" | `quote_get` → `data_get_study_values` → `data_get_pine_lines` → `data_get_pine_labels` → `data_get_pine_tables` → `data_get_ohlcv` (summary) → `capture_screenshot` |
| "Switch to AAPL daily" | `chart_set_symbol` → `chart_set_timeframe` |
| "Write a Pine Script for..." | `pine_set_source` → `pine_smart_compile` → `pine_get_errors` |
| "Start replay at March 1st" | `replay_start` → `replay_step` → `replay_trade` |
| "Set up a 4-chart grid" | `pane_set_layout` → `pane_set_symbol` for each pane |
| "Draw a level at 24500" | `draw_shape` (horizontal_line) |
| "Take a screenshot" | `capture_screenshot` |

## Tool Exposure Modes

The MCP server can advertise two different sets of tools, controlled by the `TV_MCP_EXTENDED` environment variable. This keeps the default surface focused on chart analysis and avoids exposing power-user / side-effecting tools unless you opt in.

| Mode | How to enable | Tools exposed |
|------|---------------|---------------|
| **Default** | `npm start` | 43 — data retrieval, all chart navigation + mutation, screenshots, launch |
| **Extended** | `TV_MCP_EXTENDED=1 npm start` | 88 — everything in default **plus** the 45 extended tools |

**Default group (43 tools):** health/launch (`tv_health_check`, `tv_launch`, `tv_ui_state`), all chart operations (`chart_get_state`, `chart_set_symbol`, `chart_set_timeframe`, `chart_set_type`, `chart_manage_indicator`, `chart_get_visible_range`, `chart_set_visible_range`, `chart_scroll_to_date`, `chart_report`, `chart_fetch_ohlcv`), symbols/market (`symbol_info`, `symbol_search`, `symbol_search_live`, `market_status`, `quote_get`, `depth_get`), all `data_get_*` readers, `capture_screenshot`, read-only listers (`draw_list`, `draw_get_properties`, `alert_list`, `replay_status`, `watchlist_get`, `layout_list`, `ui_find_element`, `pane_list`, `tab_list`), news (`news_get_headlines`, `news_get_story`), and `options_search`.

**Extended group (45 tools, opt-in):** all 13 Pine Script tools (even read-only ones — Pine dev is a distinct power-user capability), drawing mutators (`draw_shape`, `draw_clear`, `draw_remove_one`), alert mutators (`alert_create`, `alert_delete`), `batch_run`, all replay controls (`replay_start`, `replay_step`, `replay_autoplay`, `replay_stop`, `replay_trade`, `replay_run`), indicator mutators (`indicator_set_inputs`, `indicator_toggle_visibility`), `watchlist_add`, UI automation (`ui_click`, `ui_open_panel`, `ui_fullscreen`, `layout_switch`, `ui_keyboard`, `ui_type_text`, `ui_hover`, `ui_scroll`, `ui_mouse_click`, `ui_evaluate`), pane mutators (`pane_set_layout`, `pane_focus`, `pane_set_symbol`), tab mutators (`tab_new`, `tab_close`, `tab_switch`), and the `tv_discover` diagnostic.

Notes:
- The grouping uses a **denylist** (`src/tools/_groups.js`): any new tool added later is exposed by default unless explicitly added to the extended set.
- An unrecognized value (e.g. `TV_MCP_EXTENDED=foo`) prints a warning to stderr and falls back to the default 43-tool mode — it never throws.

## Tool Reference (78 MCP tools)

### Chart Reading

| Tool | When to use | Output size |
|------|------------|-------------|
| `chart_get_state` | First call — get symbol, timeframe, all indicator names + IDs | ~500B |
| `data_get_study_values` | Read current RSI, MACD, BB, EMA values from all indicators | ~500B |
| `quote_get` | Get latest price, OHLC, volume | ~200B |
| `data_get_ohlcv` | Get price bars. **Use `summary: true`** for compact stats | 500B (summary) / 8KB (100 bars) |

### Custom Indicator Data (Pine Drawings)

Read `line.new()`, `label.new()`, `table.new()`, `box.new()` output from any visible Pine indicator.

| Tool | When to use | Output size |
|------|------------|-------------|
| `data_get_pine_lines` | Read horizontal price levels (support/resistance, session levels) | ~1-3KB |
| `data_get_pine_labels` | Read text annotations + prices ("PDH 24550", "Bias Long") | ~2-5KB |
| `data_get_pine_tables` | Read data tables (session stats, analytics dashboards) | ~1-4KB |
| `data_get_pine_boxes` | Read price zones / ranges as {high, low} pairs | ~1-2KB |

**Always use `study_filter`** to target a specific indicator: `study_filter: "Profiler"`.

### Chart Control

| Tool | What it does |
|------|-------------|
| `chart_set_symbol` | Change ticker (BTCUSD, AAPL, ES1!, NYMEX:CL1!) |
| `chart_set_timeframe` | Change resolution (1, 5, 15, 60, D, W, M) |
| `chart_set_type` | Change style (Candles, HeikinAshi, Line, Area, Renko) |
| `chart_manage_indicator` | Add/remove indicators. **Use full names**: "Relative Strength Index" not "RSI" |
| `chart_scroll_to_date` | Jump to a date (ISO: "2025-01-15") |
| `chart_set_visible_range` | Zoom to exact range (unix timestamps) |
| `symbol_info` / `symbol_search` | Symbol metadata and search |
| `indicator_set_inputs` / `indicator_toggle_visibility` | Change indicator settings, show/hide |

### Multi-Pane Layouts

| Tool | What it does |
|------|-------------|
| `pane_list` | List all panes with symbols and active state |
| `pane_set_layout` | Change grid: `s`, `2h`, `2v`, `2x2`, `4`, `6`, `8` |
| `pane_focus` | Focus a specific pane by index |
| `pane_set_symbol` | Set symbol on any pane |

### Tab Management

| Tool | What it does |
|------|-------------|
| `tab_list` | List open chart tabs |
| `tab_new` / `tab_close` | Open/close tabs |
| `tab_switch` | Switch to a tab by index |

### Pine Script Development

| Tool | Step |
|------|------|
| `pine_set_source` | 1. Inject code into editor |
| `pine_smart_compile` | 2. Compile with auto-detection + error check |
| `pine_get_errors` | 3. Read compilation errors if any |
| `pine_get_console` | 4. Read log.info() output |
| `pine_save` | 5. Save to TradingView cloud |
| `pine_get_source` | Read current script (**warning: can be 200KB+ for complex scripts**) |
| `pine_new` | Create blank indicator/strategy/library |
| `pine_open` / `pine_list_scripts` | Open or list saved scripts |
| `pine_analyze` | Offline static analysis (no chart needed) |
| `pine_check` | Server-side compile check (no chart needed) |

### Replay Mode

| Tool | Step |
|------|------|
| `replay_start` | Enter replay at a date |
| `replay_step` | Advance one bar |
| `replay_autoplay` | Auto-advance (set speed in ms) |
| `replay_trade` | Buy/sell/close positions |
| `replay_status` | Check position, P&L, date |
| `replay_stop` | Return to realtime |

### Drawing, Alerts, UI Automation

| Tool | What it does |
|------|-------------|
| `draw_shape` | Draw horizontal_line, trend_line, rectangle, text |
| `draw_list` / `draw_remove_one` / `draw_clear` | Manage drawings |
| `alert_create` / `alert_list` / `alert_delete` | Manage price alerts |
| `capture_screenshot` | Screenshot (regions: full, chart, strategy_tester) |
| `batch_run` | Run action across multiple symbols/timeframes |
| `watchlist_get` / `watchlist_add` | Read/modify watchlist |
| `layout_list` / `layout_switch` | Manage saved layouts |
| `ui_open_panel` / `ui_click` / `ui_evaluate` | UI automation |
| `tv_launch` / `tv_health_check` / `tv_discover` | Connection management |

## Context Management

Tools return compact output by default to minimize context usage. For a typical "analyze my chart" workflow, total context is ~5-10KB instead of ~80KB.

| Feature | How it saves context |
|---------|---------------------|
| Pine lines | Returns deduplicated price levels only, not every line object |
| Pine labels | Capped at 50 per study, text+price only |
| Pine tables | Pre-formatted row strings, no cell metadata |
| Pine boxes | Deduplicated {high, low} zones only |
| OHLCV summary mode | Stats + last 5 bars instead of all bars |
| Indicator inputs | Encrypted/encoded blobs auto-filtered |
| `verbose: true` | Pass on any pine tool to get raw data with IDs/colors when needed |
| `study_filter` | Target one indicator instead of scanning all |

## Finding TradingView on Your System

Launch scripts and `tv_launch` auto-detect TradingView. If auto-detection fails:

| Platform | Common Locations |
|----------|-----------------|
| **Mac** | `/Applications/TradingView.app/Contents/MacOS/TradingView` |
| **Windows** | `%LOCALAPPDATA%\TradingView\TradingView.exe`, `%PROGRAMFILES%\WindowsApps\TradingView*\TradingView.exe` |
| **Linux** | `/opt/TradingView/tradingview`, `~/.local/share/TradingView/TradingView`, `/snap/tradingview/current/tradingview` |

The key flag: `--remote-debugging-port=9222`

## Testing

```bash
# Requires TradingView running with --remote-debugging-port=9222
npm test
```

29 tests covering: Pine Script static analysis and server-side compilation.

## Architecture

```
Claude Code  ←→  MCP Server (stdio)  ←→  CDP (port 9222)  ←→  TradingView Desktop (Electron)
```

- **Transport**: MCP over stdio (78 tools)
- **Connection**: Chrome DevTools Protocol on localhost:9222
- **No dependencies** beyond `@modelcontextprotocol/sdk` and `chrome-remote-interface`

## Attributions

This project is not affiliated with, endorsed by, or associated with:
- **TradingView Inc.** — TradingView is a trademark of TradingView Inc.
- **Anthropic** — Claude and Claude Code are trademarks of Anthropic, PBC.

This tool is an independent MCP server that connects to Claude Code via the standard MCP protocol. It does not contain or modify any Anthropic software.

## Disclaimer

This project is provided **for personal, educational, and research purposes only**.

**How this tool works:** This tool uses the Chrome DevTools Protocol (CDP), a standard debugging interface built into all Chromium-based applications by Google. It does not reverse engineer any proprietary TradingView protocol, connect to TradingView's servers, or bypass any access controls. The debug port must be explicitly enabled by the user via a standard Chromium command-line flag (`--remote-debugging-port=9222`).

By using this software, you acknowledge and agree that:

1. **You are solely responsible** for ensuring your use of this tool complies with [TradingView's Terms of Use](https://www.tradingview.com/policies/) and all applicable laws.
2. TradingView's Terms of Use **restrict automated data collection, scraping, and non-display usage** of their platform and data. This tool uses Chrome DevTools Protocol to programmatically interact with the TradingView Desktop app, which may conflict with those terms.
3. **You assume all risk** associated with using this tool. The authors are not responsible for any account bans, suspensions, legal actions, or other consequences resulting from its use.
4. This tool **must not be used** for, including but not limited to:
   - Redistributing, reselling, or commercially exploiting TradingView's market data
   - Circumventing TradingView's access controls or subscription restrictions
   - Performing automated trading or algorithmic decision-making using extracted data
   - Violating the intellectual property rights of Pine Script indicator authors
   - Connecting to TradingView's servers or infrastructure (all access is via the locally running Desktop app)
5. This tool monitors your locally running TradingView Desktop instance only. It does not connect to TradingView's servers or extract data from TradingView's infrastructure.
6. Market data accessed through this tool remains subject to exchange and data provider licensing terms. **Do not redistribute, store, or commercially exploit any data obtained through this tool.**
7. This tool accesses internal, undocumented TradingView application interfaces that may change or break at any time without notice.

**Use at your own risk.** If you are unsure whether your intended use complies with TradingView's terms, do not use this tool.

## License

MIT — see [LICENSE](LICENSE) for details.

The MIT license applies to the source code of this project only. It does not grant any rights to TradingView's software, data, trademarks, or intellectual property.

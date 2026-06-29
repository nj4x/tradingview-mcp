# Claude Code TradingView MCP Test — QQQ

Date: 2026-06-28 (re-run after MCP restart)

## Notes

- This run was executed after restarting the MCP server, so Claude sees the updated tool schemas and default/extended tool surface.
- `quote_get` fix verified: with explicit `symbol: "NASDAQ:QQQ"` it now resolves to **Invesco QQQ Trust Series I** on Cboe One. The previous run (bare `QQQ`, relying on the visible chart) had mis-resolved to `Crude Oil Futures` on `NYMEX`.
- `tv_launch`, `tv_health_check`, and all `community_*` endpoints are extended-mode tools and are absent from the default 17-tool surface (not exercised here).
- For `financials_get` and `forecast_get`, empty/omitted `fields` correctly triggered the full default field set. For `technicals_get`, empty `columns` correctly triggered the default `Recommend.All`, `Recommend.MA`, and `Recommend.Other` columns.
- `symbol_search` failed this run with HTTP 400 (`REST_HTTP`, non-retryable). `symbol_search_live` succeeded and is the working fallback for the logged-in catalog.
- `documents_list` succeeded this run (HTTP 200) but returned `total: 0` for QQQ, so `documents_get_file` was skipped — no `view_id` to pass. This differs from the prior run, where `documents_list` itself failed with HTTP 400.
- `bond_search` returned 0 results for query `QQQ` (expected — QQQ is an ETF, not a bond issuer).
- `financials_get`, `forecast_get`, and `technicals_get` returned all-`null` payloads: QQQ is an ETF with no issuer fundamentals / analyst EPS coverage / single-symbol TA rating in the scanner. The tools succeeded; the data is genuinely empty for this instrument.

## 1. quote_get

Request:

```json
{
  "symbol": "NASDAQ:QQQ"
}
```

Result:

```json
{
  "success": true,
  "symbol": "NASDAQ:QQQ",
  "time": 1782504000,
  "open": 706.73,
  "high": 708.31,
  "low": 704.64,
  "close": 706.14,
  "last": 706.14,
  "volume": 557419,
  "description": "Invesco QQQ Trust Series I",
  "exchange": "Cboe One",
  "type": "fund"
}
```

## 2. fetch_ohlcv

Request:

```json
{
  "symbol": "NASDAQ:QQQ",
  "timeframe": "240",
  "count": 10,
  "summary": false
}
```

Result:

```json
{
  "success": true,
  "symbol": "NASDAQ:QQQ",
  "timeframe": "240",
  "symbol_changed": true,
  "timeframe_changed": true,
  "bar_count": 10,
  "total_available": 300,
  "source": "direct_bars",
  "bars": [
    { "time": 1782316800, "open": 716.32, "high": 717.49, "low": 704.47, "close": 710.7, "volume": 2579875 },
    { "time": 1782331200, "open": 710.71, "high": 725.94, "low": 710, "close": 724.45, "volume": 631794 },
    { "time": 1782374400, "open": 726.57, "high": 727.4, "low": 724.54, "close": 725.29, "volume": 172484 },
    { "time": 1782388800, "open": 725.28, "high": 728.35, "low": 705.3, "close": 714.06, "volume": 3943495 },
    { "time": 1782403200, "open": 714.05, "high": 719.6, "low": 712.3, "close": 715.84, "volume": 2531345 },
    { "time": 1782417600, "open": 716.32, "high": 720.32, "low": 712.88, "close": 714.93, "volume": 454342 },
    { "time": 1782460800, "open": 711.05, "high": 712, "low": 705.88, "close": 706.88, "volume": 179699 },
    { "time": 1782475200, "open": 706.76, "high": 715.55, "low": 702.82, "close": 713.21, "volume": 2353133 },
    { "time": 1782489600, "open": 713.23, "high": 715.15, "low": 705.24, "close": 706.69, "volume": 1860489 },
    { "time": 1782504000, "open": 706.73, "high": 708.31, "low": 704.64, "close": 706.14, "volume": 557419 }
  ],
  "fresh": true,
  "last_bar_time": 1782504000,
  "freshness_waited_ms": 202
}
```

## 3. symbol_search

Request:

```json
{
  "query": "QQQ",
  "type": "fund"
}
```

Result:

```json
{
  "success": false,
  "error": "REST request failed with HTTP 400",
  "code": "REST_HTTP",
  "retryable": false
}
```

> Note: `symbol_search` failed with HTTP 400 this run. Use `symbol_search_live` (below) as the working alternative.

## 4. symbol_search_live

Request:

```json
{
  "query": "QQQ"
}
```

Result:

```json
{
  "success": true,
  "query": "QQQ",
  "source": "searchSymbols",
  "results": [
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series I", "exchange": "NASDAQ", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series I Shs Cert Deposito Arg Repr 0.05 Sh", "exchange": "BYMA", "type": "dr", "currency_code": "ARS" },
    { "symbol": "QQQ", "description": "INVESCO QQQ TRUST SERIES 1 / US DOLLAR", "exchange": "Pyth", "type": "stock", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "Questcorp Mining, Inc.", "exchange": "CSE", "type": "stock", "currency_code": "CAD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series I", "exchange": "BMV", "type": "fund", "currency_code": "MXN" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series I", "exchange": "BIVA", "type": "fund", "currency_code": "MXN" },
    { "symbol": "QQQ", "description": "Questcorp Mining, Inc.", "exchange": "NEO", "type": "stock", "currency_code": "CAD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series I", "exchange": "BOATS", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust", "exchange": "Vantage", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series 1", "exchange": "Eightcap", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust, Series 1", "exchange": "FXCM", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "PowerShares QQQ Trust Series 1 (All Sess", "exchange": "Spreadex", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series 1", "exchange": "CFI", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQ", "description": "Invesco QQQ Trust Series 1", "exchange": "ThinkMarkets", "type": "fund", "currency_code": "USD" },
    { "symbol": "QQQM", "description": "Invesco NASDAQ 100 ETF", "exchange": "NASDAQ", "type": "fund", "currency_code": "USD" }
  ],
  "count": 15
}
```

## 5. symbol_info

Request:

```json
{
  "symbol": "NASDAQ:QQQ"
}
```

Result:

```json
{
  "success": true,
  "symbol": "QQQ",
  "full_name": "BATS:QQQ",
  "exchange": "Cboe One",
  "description": "Invesco QQQ Trust Series I",
  "type": "fund",
  "pro_name": "NASDAQ:QQQ",
  "typespecs": [
    "etf"
  ],
  "resolution": "240",
  "chart_type": 1,
  "source": "cdp"
}
```

## 6. watchlist_get

Request:

```json
{}
```

Result:

```json
{
  "success": true,
  "count": 63,
  "source": "rest_api",
  "list_name": "Watchlist",
  "symbols": [
    { "symbol": "NASDAQ:TSLA", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:AMD", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:TTE", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:INTC", "last": null, "change": null, "change_percent": null },
    { "symbol": "KRAKEN:BTCUSD", "last": null, "change": null, "change_percent": null },
    { "symbol": "KRAKEN:ETHUSD", "last": null, "change": null, "change_percent": null },
    { "symbol": "BINANCE:SOLUSD", "last": null, "change": null, "change_percent": null },
    { "symbol": "BINANCE:DOGEUSD", "last": null, "change": null, "change_percent": null },
    { "symbol": "TVC:DXY", "last": null, "change": null, "change_percent": null },
    { "symbol": "FX:EURUSD", "last": null, "change": null, "change_percent": null },
    { "symbol": "FOREXCOM:USDCAD", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:TSM", "last": null, "change": null, "change_percent": null },
    { "symbol": "AMEX:THNQ", "last": null, "change": null, "change_percent": null },
    { "symbol": "CBOE:WTAI", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:BN", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:BIPC", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:GOOG", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:MSFT", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:CRWD", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:ENB", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:ABX", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:SU", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:XEQT", "last": null, "change": null, "change_percent": null },
    { "symbol": "AMEX:JEPI", "last": null, "change": null, "change_percent": null },
    { "symbol": "AMEX:SCHD", "last": null, "change": null, "change_percent": null },
    { "symbol": "AMEX:VTI", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:AC", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:LAC", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:AAPL", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:ORCL", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:NFLX", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:META", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:COKE", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:TD", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:DOL", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:CNQ", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:GSY", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:GEO", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:CXW", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:UPBD", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:ZD", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:QQQ", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:NVDA", "last": null, "change": null, "change_percent": null },
    { "symbol": "TSX:VDY", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:OKLO", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:SMR", "last": null, "change": null, "change_percent": null },
    { "symbol": "KRX:005930", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:NDX", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:EBAY", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:AMZN", "last": null, "change": null, "change_percent": null },
    { "symbol": "TVC:VIX", "last": null, "change": null, "change_percent": null },
    { "symbol": "CBOE:VIX1D", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYMEX:CL1!", "last": null, "change": null, "change_percent": null },
    { "symbol": "SPCFD:SPX", "last": null, "change": null, "change_percent": null },
    { "symbol": "AMEX:SPY", "last": null, "change": null, "change_percent": null },
    { "symbol": "CBOEFTSE:RUT", "last": null, "change": null, "change_percent": null },
    { "symbol": "OTC:HENOY", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:SNPS", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:CHTR", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:QUBT", "last": null, "change": null, "change_percent": null },
    { "symbol": "AMEX:IWM", "last": null, "change": null, "change_percent": null },
    { "symbol": "NYSE:IBM", "last": null, "change": null, "change_percent": null },
    { "symbol": "NASDAQ:SPCX", "last": null, "change": null, "change_percent": null }
  ]
}
```

## 7. news_get_headlines

Request:

```json
{
  "symbol": "NASDAQ:QQQ",
  "limit": 5
}
```

Result:

```json
{
  "success": true,
  "symbol": "NASDAQ:QQQ",
  "count": 5,
  "results": [
    {
      "id": "stocktwits:d474aca93094b:0",
      "title": "Hours After Trump Called Strait Of Hormuz Drone Attack A ‘Foolish Violation,’ US Says It Struck Iran",
      "provider": "stocktwits",
      "published": 1782510864,
      "urgency": 2,
      "source": "Stocktwits",
      "relatedSymbols": [
        { "symbol": "NASDAQ:QQQ", "logoid": "invesco" },
        { "symbol": "NASDAQ:TLT", "logoid": "ishares" }
      ]
    },
    {
      "id": "stocktwits:db8c7ea25094b:0",
      "title": "Trump Threatens 100% Tariff On Countries Imposing Digital Services Tax On American Firms — ‘This Tariff Will Supercede Trade Deals’",
      "provider": "stocktwits",
      "published": 1782494260,
      "urgency": 2,
      "source": "Stocktwits",
      "relatedSymbols": [
        { "symbol": "NASDAQ:QQQ", "logoid": "invesco" }
      ]
    },
    {
      "id": "stocktwits:b23644181094b:0",
      "title": "Micron Added Over $1.2 Trillion In Market Cap In A Year — This Analyst Says The AI Memory Rally Has More Room To Run",
      "provider": "stocktwits",
      "published": 1782485673,
      "urgency": 2,
      "source": "Stocktwits",
      "relatedSymbols": [
        { "symbol": "NASDAQ:MU", "logoid": "micron-technology" },
        { "symbol": "NASDAQ:QQQ", "logoid": "invesco" },
        { "symbol": "NASDAQ:SOXX", "logoid": "ishares" }
      ]
    },
    {
      "id": "stocktwits:00014828b094b:0",
      "title": "Paul Krugman Explains Why Americans Are Turning Against AI — Says Anthropic's Dario Amodei Helped Fuel 'Jobs Apocalypse' Fears",
      "provider": "stocktwits",
      "published": 1782391617,
      "urgency": 2,
      "source": "Stocktwits",
      "relatedSymbols": [
        { "symbol": "NASDAQ:MSFT", "logoid": "microsoft" },
        { "symbol": "NASDAQ:QQQ", "logoid": "invesco" },
        { "symbol": "NASDAQ:AIQ", "logoid": "global-x" }
      ]
    },
    {
      "id": "stocktwits:ef7dcb95a094b:0",
      "title": "Cathie Wood Predicts Inflation Could ‘Break Down In A Big Way’ – Says Kevin Warsh-Led Fed Will ‘Encourage’ Growth",
      "provider": "stocktwits",
      "published": 1782366987,
      "urgency": 2,
      "source": "Stocktwits",
      "relatedSymbols": [
        { "symbol": "NASDAQ:QQQ", "logoid": "invesco" }
      ]
    }
  ],
  "source": "rest_api"
}
```

## 8. news_get_story

Request (first headline id from above):

```json
{
  "id": "stocktwits:d474aca93094b:0"
}
```

Result:

```json
{
  "success": true,
  "title": "Hours After Trump Called Strait Of Hormuz Drone Attack A ‘Foolish Violation,’ US Says It Struck Iran",
  "provider": "stocktwits",
  "source": "Stocktwits",
  "published": 1782510864,
  "link": "https://stocktwits.com/news-articles/markets/equity/hours-after-trump-called-strait-of-hormuz-drone-attack-foolish-violation-us-says-it-struck-iran/cZ12RiwR7WJ",
  "shortDescription": "The US military said on Friday it struck Iran after what it described as an attack on a commercial cargo ship in the Strait of Hormuz. The action came hours after President Donald Trump condemned the drone attack as a “foolish violation” of the ceasefire agreement.At the time of writing, U.S. equit…",
  "body": ""
}
```

## 9. financials_get

Request (empty `fields` → default full field set):

```json
{
  "symbol": "NASDAQ:QQQ",
  "fields": ""
}
```

Result:

```json
{
  "success": true,
  "symbol": "NASDAQ:QQQ",
  "data": {
    "earnings_per_share_basic_ttm": null,
    "ebit": null,
    "ebitda": null,
    "gross_profit": null,
    "net_income": null,
    "oper_income": null,
    "price_book": null,
    "price_cash_flow": null,
    "price_earnings_ttm": null,
    "total_assets": null,
    "total_equity": null,
    "total_liabilities": null,
    "total_revenue": null
  },
  "source": "rest_api"
}
```

> All-`null` is expected: QQQ is an ETF with no issuer-level financials. The default field set was applied correctly from the empty `fields`.

## 10. forecast_get

Request (empty `fields` → default full field set):

```json
{
  "symbol": "NASDAQ:QQQ",
  "fields": ""
}
```

Result:

```json
{
  "success": true,
  "symbol": "NASDAQ:QQQ",
  "data": {
    "earnings_per_share_forecast_next_fq": null,
    "earnings_release_date": null,
    "earnings_release_next_date": null,
    "price_target_average": null,
    "price_target_estimates_num": null,
    "price_target_high": null,
    "price_target_low": null,
    "price_target_median": null,
    "recommendation_buy": null,
    "recommendation_hold": null,
    "recommendation_mark": null,
    "recommendation_sell": null,
    "recommendation_total": null,
    "revenue_forecast_next_fq": null,
    "recommendation_label": null
  },
  "recommendation_label": null,
  "source": "rest_api"
}
```

> All-`null` is expected: ETFs have no sell-side EPS/price-target consensus. Default field set applied correctly.

## 11. technicals_get

Request (empty `columns` → default `Recommend.All`/`Recommend.MA`/`Recommend.Other`):

```json
{
  "symbol": "NASDAQ:QQQ",
  "columns": [],
  "interval": "1D"
}
```

Result:

```json
{
  "success": true,
  "symbol": "NASDAQ:QQQ",
  "screener": "america",
  "screener_guessed": false,
  "interval": "1D",
  "recommendation": { "value": null, "label": "N/A" },
  "oscillators": { "value": null, "label": "N/A" },
  "moving_averages": { "value": null, "label": "N/A" },
  "raw": {
    "Recommend.All|1D": null,
    "Recommend.MA|1D": null,
    "Recommend.Other|1D": null
  },
  "source": "rest_api"
}
```

> Default columns were applied correctly from the empty `columns` array. Values are `null` because the `america` screener does not carry a TA rating row for this ETF symbol.

## 12. etf_search

Request:

```json
{
  "query": "QQQ",
  "limit": 5
}
```

Result:

```json
{
  "success": true,
  "source": "rest_api",
  "count": 5,
  "results": [
    {
      "symbol": "AMEX:VOO",
      "name": "VOO",
      "description": "Vanguard S&P 500 ETF",
      "close": 670.26,
      "change": -0.8065590268014452,
      "aum": 956718847661.081,
      "expense_ratio": 0.03,
      "asset_class": "Equity",
      "focus": "Large cap",
      "nav_return_3y": 74.80590104357526,
      "fund_flows_1m": -4076089387.9429045,
      "currency": "USD"
    },
    {
      "symbol": "AMEX:IVV",
      "name": "IVV",
      "description": "iShares Core S&P 500 ETF",
      "close": 730.17,
      "change": -0.8594704684317774,
      "aum": 873136822219.2,
      "expense_ratio": 0.03,
      "asset_class": "Equity",
      "focus": "Large cap",
      "nav_return_3y": 74.82402710550554,
      "fund_flows_1m": 58300336107.399994,
      "currency": "USD"
    },
    {
      "symbol": "AMEX:SPY",
      "name": "SPY",
      "description": "State Street SPDR S&P 500 ETF",
      "close": 728.99,
      "change": -0.7231376821462543,
      "aum": 776183497060.322,
      "expense_ratio": 0.0945,
      "asset_class": "Equity",
      "focus": "Large cap",
      "nav_return_3y": 74.39211761051972,
      "fund_flows_1m": 19004662007.149998,
      "currency": "USD"
    },
    {
      "symbol": "AMEX:VTI",
      "name": "VTI",
      "description": "Vanguard Total Stock Market ETF",
      "close": 362.22,
      "change": -0.4835430518160313,
      "aum": 651300801181.8,
      "expense_ratio": 0.03,
      "asset_class": "Equity",
      "focus": "Total market",
      "nav_return_3y": 74.13649621118121,
      "fund_flows_1m": 6516524010.929999,
      "currency": "USD"
    },
    {
      "symbol": "NASDAQ:QQQ",
      "name": "QQQ",
      "description": "Invesco QQQ Trust Series I",
      "close": 706.52,
      "change": -1.3763644992880892,
      "aum": 481429996200,
      "expense_ratio": 0.18,
      "asset_class": "Equity",
      "focus": "Large cap",
      "nav_return_3y": 97.54610970331647,
      "fund_flows_1m": 5713928150,
      "currency": "USD"
    }
  ]
}
```

> `etf_search` ranks by AUM, so the QQQ query returns the largest equity ETFs with QQQ included rather than a name-filtered list.

## 13. etf_get

Request:

```json
{
  "symbol": "NASDAQ:QQQ"
}
```

Result:

```json
{
  "success": true,
  "source": "rest_api",
  "etf": {
    "symbol": "NASDAQ:QQQ",
    "name": "QQQ",
    "description": "Invesco QQQ Trust Series I",
    "close": 706.52,
    "change": -1.3763644992880892,
    "aum": 481429996200,
    "expense_ratio": 0.18,
    "asset_class": "Equity",
    "focus": "Large cap",
    "nav_return_3y": 97.54610970331647,
    "fund_flows_1m": 5713928150
  }
}
```

## 14. bond_search

Request:

```json
{
  "query": "QQQ",
  "min_yield": 0,
  "max_yield": 0,
  "limit": 5
}
```

Result:

```json
{
  "success": true,
  "count": 0,
  "total_count": 0,
  "results": [],
  "source": "rest_api"
}
```

> 0 results is expected — QQQ is an ETF and has no associated bonds.

## 15. documents_list

Request:

```json
{
  "symbol": "NASDAQ:QQQ",
  "categories": [],
  "lang": "en",
  "limit": 5
}
```

Result:

```json
{
  "success": true,
  "symbol": "NASDAQ:QQQ",
  "total": 0,
  "count": 0,
  "items": [],
  "source": "rest_api"
}
```

> The call now succeeds (HTTP 200) — a regression-free improvement over the prior run's HTTP 400. QQQ (an ETF) simply has no Quartr-sourced filings/transcripts, so `total: 0`.

## 16. documents_get_file

Skipped: `documents_list` returned `total: 0` with no `view_ids`, so there is no first-document `view_id` to fetch. The tool itself was not exercised this run.

```json
{
  "skipped": true,
  "reason": "documents_list returned 0 items for NASDAQ:QQQ; no view_id available to pass"
}
```

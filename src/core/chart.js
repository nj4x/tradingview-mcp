/**
 * Core chart control logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, safeString, requireFinite } from '../connection.js';
import { waitForChartReady as _waitForChartReady } from '../wait.js';
import { getStudyValues, getPineGraphics, getQuote, getOhlcv } from './data.js';
import { captureScreenshot as _captureScreenshot } from './capture.js';
import { isoToUnix } from './utils.js';
import { makeResolver } from './_resolve.js';
import { restFromNode } from './_rest.js';

const CHART_API = 'window.TradingViewApi._activeChartWidgetWV.value()';

const _resolve = makeResolver(['evaluate', 'evaluateAsync'], { waitForChartReady: _waitForChartReady, fetch: globalThis.fetch, setSymbolHint: () => {} });

export async function getState({ _deps } = {}) {
  const { evaluate, setSymbolHint } = _resolve(_deps);
  const state = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var studies = [];
      try {
        var allStudies = chart.getAllStudies();
        studies = allStudies.map(function(s) {
          return { id: s.id, name: s.name || s.title || 'unknown' };
        });
      } catch(e) {}
      return {
        symbol: chart.symbol(),
        resolution: chart.resolution(),
        chartType: chart.chartType(),
        studies: studies,
      };
    })()
  `);
  if (state && state.symbol) setSymbolHint(state.symbol);
  return { success: true, ...state };
}

export async function setSymbol({ symbol, _deps }) {
  const { evaluateAsync, waitForChartReady, setSymbolHint } = _resolve(_deps);
  await evaluateAsync(`
    (function() {
      var chart = ${CHART_API};
      return new Promise(function(resolve) {
        chart.setSymbol(${safeString(symbol)}, {});
        setTimeout(resolve, 500);
      });
    })()
  `);
  const ready = await waitForChartReady(symbol);
  setSymbolHint(symbol);
  return { success: true, symbol, chart_ready: ready };
}

export async function setTimeframe({ timeframe, _deps }) {
  const { evaluate, waitForChartReady } = _resolve(_deps);
  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      chart.setResolution(${safeString(timeframe)}, {});
    })()
  `);
  const ready = await waitForChartReady(null, timeframe);
  return { success: true, timeframe, chart_ready: ready };
}

export async function setType({ chart_type, _deps }) {
  const { evaluate } = _resolve(_deps);
  const typeMap = {
    'Bars': 0, 'Candles': 1, 'Line': 2, 'Area': 3,
    'Renko': 4, 'Kagi': 5, 'PointAndFigure': 6, 'LineBreak': 7,
    'HeikinAshi': 8, 'HollowCandles': 9,
  };
  const typeNum = typeMap[chart_type] ?? Number(chart_type);
  if (isNaN(typeNum) || typeNum < 0 || typeNum > 9 || !Number.isInteger(typeNum)) {
    throw new Error(`Unknown chart type: ${chart_type}. Use a name (Candles, Line, etc.) or number (0-9).`);
  }
  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      chart.setChartType(${typeNum});
    })()
  `);
  return { success: true, chart_type, type_num: typeNum };
}

export async function manageIndicator({ action, indicator, entity_id, inputs: inputsRaw, _deps }) {
  const { evaluate } = _resolve(_deps);
  const inputs = inputsRaw ? (typeof inputsRaw === 'string' ? JSON.parse(inputsRaw) : inputsRaw) : undefined;

  if (action === 'add') {
    const inputArr = inputs ? Object.entries(inputs).map(([k, v]) => ({ id: k, value: v })) : [];
    const before = await evaluate(`${CHART_API}.getAllStudies().map(function(s) { return s.id; })`);
    await evaluate(`
      (function() {
        var chart = ${CHART_API};
        chart.createStudy(${safeString(indicator)}, false, false, ${JSON.stringify(inputArr)});
      })()
    `);
    await new Promise(r => setTimeout(r, 1500));
    const after = await evaluate(`${CHART_API}.getAllStudies().map(function(s) { return s.id; })`);
    const newIds = (after || []).filter(id => !(before || []).includes(id));
    return { success: newIds.length > 0, action: 'add', indicator, entity_id: newIds[0] || null, new_study_count: newIds.length };
  } else if (action === 'remove') {
    if (!entity_id) throw new Error('entity_id required for remove action. Use chart_get_state to find study IDs.');
    await evaluate(`
      (function() {
        var chart = ${CHART_API};
        chart.removeEntity(${safeString(entity_id)});
      })()
    `);
    return { success: true, action: 'remove', entity_id };
  } else {
    throw new Error('action must be "add" or "remove"');
  }
}

export async function getVisibleRange({ _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      return { visible_range: chart.getVisibleRange(), bars_range: chart.getVisibleBarsRange() };
    })()
  `);
  return { success: true, visible_range: result.visible_range, bars_range: result.bars_range };
}

export async function setVisibleRange({ from, to, _deps }) {
  const { evaluate } = _resolve(_deps);
  // Accept ISO-8601 strings (e.g. "2025-01-15") alongside unix timestamps.
  const f = requireFinite(isoToUnix(from), 'from');
  const t = requireFinite(isoToUnix(to), 'to');
  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = chart._chartWidget.model();
      var ts = m.timeScale();
      var bars = m.mainSeries().bars();
      var startIdx = bars.firstIndex();
      var endIdx = bars.lastIndex();
      var fromIdx = startIdx, toIdx = endIdx;
      for (var i = startIdx; i <= endIdx; i++) {
        var v = bars.valueAt(i);
        if (v && v[0] >= ${f} && fromIdx === startIdx) fromIdx = i;
        if (v && v[0] <= ${t}) toIdx = i;
      }
      ts.zoomToBarsRange(fromIdx, toIdx);
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
  const actual = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      try { var r = chart.getVisibleRange(); return { from: r.from || 0, to: r.to || 0 }; }
      catch(e) { return { from: 0, to: 0, error: e.message }; }
    })()
  `);
  return { success: true, requested: { from, to }, actual: actual || { from: 0, to: 0 } };
}

export async function scrollToDate({ date, _deps } = {}) {
  const { evaluate } = _resolve(_deps);
  // Coerce ISO-8601 strings → unix seconds; numeric strings pass through unchanged.
  const timestamp = isoToUnix(date);
  if (isNaN(timestamp)) throw new Error(`Could not parse date: ${date}. Use ISO format (2024-01-15) or unix timestamp.`);

  const resolution = await evaluate(`${CHART_API}.resolution()`);
  let secsPerBar = 60;
  const res = String(resolution);
  if (res === 'D' || res === '1D') secsPerBar = 86400;
  else if (res === 'W' || res === '1W') secsPerBar = 604800;
  else if (res === 'M' || res === '1M') secsPerBar = 2592000;
  else { const mins = parseInt(res, 10); if (!isNaN(mins)) secsPerBar = mins * 60; }

  const halfWindow = 25 * secsPerBar;
  const from = timestamp - halfWindow;
  const to = timestamp + halfWindow;

  await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var m = chart._chartWidget.model();
      var ts = m.timeScale();
      var bars = m.mainSeries().bars();
      var startIdx = bars.firstIndex();
      var endIdx = bars.lastIndex();
      var fromIdx = startIdx, toIdx = endIdx;
      for (var i = startIdx; i <= endIdx; i++) {
        var v = bars.valueAt(i);
        if (v && v[0] >= ${from} && fromIdx === startIdx) fromIdx = i;
        if (v && v[0] <= ${to}) toIdx = i;
      }
      ts.zoomToBarsRange(fromIdx, toIdx);
    })()
  `);
  await new Promise(r => setTimeout(r, 500));
  return { success: true, date, centered_on: timestamp, resolution, window: { from, to } };
}

export async function symbolInfo({ symbol, _deps } = {}) {
  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');
  const { evaluate, setSymbolHint } = _resolve(_deps);
  const current = await evaluate(`${CHART_API}.symbol()`);
  if (symbol !== current) await setSymbol({ symbol, _deps });
  setSymbolHint(symbol);
  const result = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      var info = chart.symbolExt();
      return {
        symbol: info.symbol, full_name: info.full_name, exchange: info.exchange,
        description: info.description, type: info.type, pro_name: info.pro_name,
        typespecs: info.typespecs, resolution: chart.resolution(), chart_type: chart.chartType()
      };
    })()
  `);
  return { success: true, ...result, source: 'cdp' };
}

export async function symbolSearch({ query, type, _deps } = {}) {
  // Use TradingView's public symbol search REST API (works without auth)
  const { fetch } = _resolve(_deps);
  const params = new URLSearchParams({
    text: query,
    hl: '1',
    exchange: '',
    lang: 'en',
    search_type: type || '',
    domain: 'production',
  });

  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?${params}`;
  const data = await restFromNode(fetch, url, {
    headers: { Origin: 'https://www.tradingview.com', Referer: 'https://www.tradingview.com/' },
  });

  const strip = s => (s || '').replace(/<\/?em>/g, '');
  const results = (data.symbols || data || []).slice(0, 15).map(r => ({
    symbol: strip(r.symbol),
    description: strip(r.description),
    exchange: r.exchange || r.prefix || '',
    type: r.type || '',
    full_name: r.exchange ? `${r.exchange}:${strip(r.symbol)}` : strip(r.symbol),
  }));

  return { success: true, query, source: 'rest_api', results, count: results.length };
}

const REPORT_SECTIONS = ['state', 'study_values', 'pine_lines', 'pine_labels', 'pine_tables', 'pine_boxes', 'quote', 'ohlcv', 'screenshot'];
const DEFAULT_REPORT_INCLUDE = ['state', 'study_values', 'quote'];
const REPORT_MAX_BYTES = 50 * 1024;
const PINE_SECTIONS = { pine_lines: 'lines', pine_labels: 'labels', pine_tables: 'tables', pine_boxes: 'boxes' };

export async function analyzeChart({ include, study_filter, ohlcv_count, screenshot_region, _deps } = {}) {
  const { evaluate, evaluateAsync } = _resolve(_deps);
  const deps = { evaluate, evaluateAsync };
  const sel = (Array.isArray(include) && include.length > 0)
    ? include.filter(s => REPORT_SECTIONS.includes(s))
    : DEFAULT_REPORT_INCLUDE.slice();
  const want = s => sel.includes(s);

  const result = { success: true };
  const run = async (key, fn) => {
    try { result[key] = await fn(); }
    catch (err) { result[key] = { error: err.message }; }
  };

  const pineWanted = Object.keys(PINE_SECTIONS).filter(want);
  const tasks = [];

  if (want('state')) tasks.push(run('state', () => getState({ _deps: deps })));
  if (want('quote')) tasks.push(run('quote', () => getQuote({ _deps: deps })));
  if (want('study_values')) tasks.push(run('study_values', () => getStudyValues({ _deps: deps })));
  if (want('ohlcv')) tasks.push(run('ohlcv', () => getOhlcv({ count: ohlcv_count, summary: true, _deps: deps })));
  if (pineWanted.length > 0) {
    tasks.push((async () => {
      try {
        const g = await getPineGraphics({ include: pineWanted.map(k => PINE_SECTIONS[k]), study_filter, _deps: deps });
        for (const k of pineWanted) result[k] = g[PINE_SECTIONS[k]] ?? [];
      } catch (err) {
        for (const k of pineWanted) result[k] = { error: err.message };
      }
    })());
  }

  await Promise.all(tasks);

  if (want('screenshot')) {
    const capture = _deps?.captureScreenshot || _captureScreenshot;
    try {
      const shot = await capture({ region: screenshot_region || 'chart' });
      result.screenshot_path = shot.file_path || null;
    } catch (err) {
      result.screenshot_path = null;
      result.screenshot = { error: err.message };
    }
  }

  _capReport(result, sel);
  return result;
}

function _capReport(result, sel) {
  const sizeOf = () => Buffer.byteLength(JSON.stringify(result), 'utf8');
  if (sizeOf() <= REPORT_MAX_BYTES) return;
  const dataKeys = Object.keys(result).filter(k => k !== 'success' && k !== 'truncated');
  const ordered = dataKeys.sort((a, b) => {
    const ai = sel.includes(a) ? 0 : 1;
    const bi = sel.includes(b) ? 0 : 1;
    if (ai !== bi) return ai - bi;
    return a.localeCompare(b);
  });
  const truncated = [];
  for (const k of ordered) {
    if (sizeOf() <= REPORT_MAX_BYTES) break;
    delete result[k];
    truncated.push(k);
  }
  if (truncated.length > 0) result.truncated = truncated;
}

export async function symbolSearchLive({ query, _deps } = {}) {
  if (!query || !String(query).trim()) throw new Error('query is required');
  const { evaluateAsync } = _resolve(_deps);
  const result = await evaluateAsync(`
    (async function() {
      try {
        var r = await window.TradingViewApi.searchSymbols({ text: ${safeString(query)} });
        return r && r.symbols ? r.symbols : [];
      } catch (e) { return { __error: e.message }; }
    })()
  `);
  if (result && result.__error) throw new Error(result.__error);
  const strip = s => (s || '').replace(/<\/?em>/g, '');
  const arr = Array.isArray(result) ? result : [];
  const results = arr.slice(0, 15).map(r => ({
    symbol: strip(r.symbol),
    description: strip(r.description),
    exchange: r.exchange || '',
    type: r.type || '',
    currency_code: r.currency_code || '',
  }));
  return { success: true, query, source: 'searchSymbols', results, count: results.length };
}

// ── Phase 2 composites + ergonomics ──

/**
 * Fetch OHLCV for an arbitrary symbol/timeframe in one call.
 * Mutates the chart intentionally (does NOT restore prior state — same as batch_run).
 * Skips setSymbol/setTimeframe when the requested value already matches the chart,
 * avoiding a redundant reload.
 */
export async function fetchOhlcv({ symbol, timeframe, count, summary, _deps } = {}) {
  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');
  const { evaluate, setSymbolHint } = _resolve(_deps);

  const current = await evaluate(`
    (function() {
      var chart = ${CHART_API};
      return { symbol: chart.symbol(), resolution: chart.resolution() };
    })()
  `);

  let symbol_changed = false;
  let timeframe_changed = false;

  if (symbol === current?.symbol) {
    // Fast path: tab is already on this symbol — record affinity without reloading.
    setSymbolHint(symbol);
  } else {
    await setSymbol({ symbol, _deps });
    // Only stamp affinity AFTER a successful switch, so a failed setSymbol never
    // poisons the connection's symbol cache with a symbol the tab isn't loaded on.
    setSymbolHint(symbol);
    symbol_changed = true;
  }
  if (timeframe !== undefined && timeframe !== null && String(timeframe) !== String(current?.resolution)) {
    await setTimeframe({ timeframe, _deps });
    timeframe_changed = true;
  }

  const ohlcv = await getOhlcv({ count, summary, _deps });

  const resolved_timeframe = (timeframe !== undefined && timeframe !== null)
    ? timeframe
    : current?.resolution;
  const bar_count = Array.isArray(ohlcv.bars) ? ohlcv.bars.length : (ohlcv.bar_count ?? null);

  return {
    success: true,
    symbol,
    timeframe: resolved_timeframe,
    symbol_changed,
    timeframe_changed,
    bar_count,
    ...ohlcv,
  };
}

/**
 * Read the current symbol's market session status (open/closed/pre/post-market).
 * Reads chart.symbolExt() for the session descriptor TradingView exposes.
 */
export async function getMarketStatus({ symbol, _deps } = {}) {
  if (!symbol || !String(symbol).trim()) throw new Error('symbol is required');
  const { evaluate, setSymbolHint } = _resolve(_deps);
  const current = await evaluate(`${CHART_API}.symbol()`);
  if (symbol !== current) await setSymbol({ symbol, _deps });
  setSymbolHint(symbol);
  const info = await evaluate(`
    (function() {
      try {
        var chart = ${CHART_API};
        var ext = chart.symbolExt();
        if (!ext) return null;
        return {
          symbol: ext.symbol,
          exchange: ext.exchange,
          session: ext.session,
          session_display: ext.session_display,
          subsession_id: ext.subsession_id,
          subsessions: ext.subsessions,
          timezone: ext.timezone,
          is_tradable: typeof chart.isMarketAvailable === 'function' ? chart.isMarketAvailable() : undefined,
        };
      } catch (e) { return { __error: e.message }; }
    })()
  `);

  if (!info || info.__error || info.session === undefined || info.session === null) {
    return { success: false, error: 'session data unavailable', source: 'cdp' };
  }

  // TradingView's marketStatus, when present on the runtime, is the authoritative
  // open/closed flag. We derive a best-effort status name from the session fields.
  const status = _deriveSessionStatus(info);

  return {
    success: true,
    status,
    symbol: info.symbol,
    exchange: info.exchange,
    session: info.session,
    session_display: info.session_display || null,
    timezone: info.timezone || null,
    is_tradable: info.is_tradable ?? null,
    source: 'cdp',
  };
}

/**
 * Best-effort mapping of a symbolExt() descriptor to a coarse status name.
 * The `session` field is a session-spec string (e.g. "0930-1600"), not a live state,
 * so we map the active subsession id where available; otherwise return "unknown".
 */
function _deriveSessionStatus(info) {
  const sid = String(info.subsession_id || '').toLowerCase();
  if (sid.includes('pre')) return 'pre_market';
  if (sid.includes('post') || sid.includes('after')) return 'post_market';
  if (sid === 'regular' || sid.includes('regular')) return 'open';
  // 24x7 sessions (crypto/forex) advertise a continuous session spec.
  if (String(info.session || '') === '24x7') return 'open';
  return 'unknown';
}

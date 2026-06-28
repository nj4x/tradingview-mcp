/**
 * Core watchlist logic.
 *
 * REST-first (the TradingView MCP doctrine): the active watchlist is read from
 * TradingView's authenticated REST endpoint executed inside the logged-in
 * renderer (credentials: 'include'). This avoids the GUI failure mode where the
 * watchlist side panel cannot be opened programmatically on the Electron build
 * (the lazy widget never initializes without a real user gesture), which made the
 * old DOM path return a spurious empty/closed result.
 *
 * The legacy DOM path is preserved as _getViaCdp and used as an automatic
 * fallback when REST fails, or forced when TV_MCP_REST=0.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getClient } from '../connection.js';
import { makeResolver } from './_resolve.js';
import { restFromRenderer, isRestDisabled } from './_rest.js';

const _resolve = makeResolver(['evaluate', 'evaluateAsync']);

const WATCHLIST_URL = 'https://www.tradingview.com/api/v1/symbols_list/custom/';

export async function get({ _deps } = {}) {
  const { evaluate, evaluateAsync } = _resolve(_deps);

  if (!isRestDisabled()) {
    try {
      return await _getViaRest(evaluateAsync);
    } catch (_) {
      // fall through to the CDP/DOM path on any REST failure
      return _getViaCdp(evaluate, evaluateAsync);
    }
  }
  return _getViaCdp(evaluate, evaluateAsync);
}

/**
 * Read the active watchlist via the authenticated REST endpoint. Returns the
 * canonical shape; price fields are null because this endpoint returns symbol
 * tickers only (no quote data).
 */
async function _getViaRest(evaluateAsync) {
  const data = await restFromRenderer(evaluateAsync, WATCHLIST_URL);
  const lists = Array.isArray(data) ? data : [];
  // Prefer the list flagged active; fall back to the first list.
  const active = lists.find((l) => l && l.active) || lists[0] || null;
  const tickers = (active && Array.isArray(active.symbols)) ? active.symbols : [];
  const symbols = tickers.map((sym) => ({
    symbol: sym,
    last: null,
    change: null,
    change_percent: null,
  }));
  return {
    success: true,
    count: symbols.length,
    source: 'rest_api',
    symbols,
    list_name: active && active.name ? active.name : null,
  };
}

async function _getViaCdp(evaluate, evaluateAsync) {
  // Ensure the watchlist panel is open before reading — a closed panel must not
  // masquerade as an empty watchlist.
  await _ensureWatchlistOpen(evaluate, evaluateAsync);

  // Read data-symbol-full attributes from watchlist rows, with text fallback.
  const symbols = await evaluate(`
    (function() {
      var results = [];
      var seen = {};
      var container = document.querySelector('[class*="layout__area--right"]');
      if (!container) return { symbols: [], source: 'no_container' };

      var symbolEls = container.querySelectorAll('[data-symbol-full]');
      for (var i = 0; i < symbolEls.length; i++) {
        var sym = symbolEls[i].getAttribute('data-symbol-full');
        if (!sym || seen[sym]) continue;
        seen[sym] = true;

        var row = symbolEls[i].closest('[class*="row"]') || symbolEls[i].parentElement;
        var cells = row ? row.querySelectorAll('[class*="cell"], [class*="column"]') : [];
        var nums = [];
        for (var j = 0; j < cells.length; j++) {
          var t = cells[j].textContent.trim();
          if (t && /^[\\-+]?[\\d,]+\\.?\\d*%?$/.test(t.replace(/[\\s,]/g, ''))) nums.push(t);
        }
        results.push({ symbol: sym, last: nums[0] || null, change: nums[1] || null, change_percent: nums[2] || null });
      }

      if (results.length > 0) return { symbols: results, source: 'data_attributes' };

      var items = container.querySelectorAll('[class*="symbolName"], [class*="tickerName"], [class*="symbol-"]');
      for (var k = 0; k < items.length; k++) {
        var text = items[k].textContent.trim();
        if (text && /^[A-Z][A-Z0-9.:!]{0,20}$/.test(text) && !seen[text]) {
          seen[text] = true;
          results.push({ symbol: text, last: null, change: null, change_percent: null });
        }
      }

      return { symbols: results, source: results.length > 0 ? 'text_scan' : 'empty' };
    })()
  `);

  return {
    success: true,
    count: symbols?.symbols?.length || 0,
    source: symbols?.source || 'unknown',
    symbols: symbols?.symbols || [],
  };
}

/**
 * Ensure the watchlist side panel is open. Clicks the watchlist toggle button
 * when the panel is closed and polls until the right sidebar is visible.
 * Throws if the button can't be found or the panel never opens.
 */
async function _ensureWatchlistOpen(evaluate, evaluateAsync) {
  const result = await evaluate(`
    (function() {
      var btn = document.querySelector('[data-name="base-watchlist-widget-button"]')
        || document.querySelector('[aria-label="Watchlist"]');
      if (!btn) return { error: 'Watchlist button not found' };
      var cls = btn.classList.toString();
      var isActive = btn.getAttribute('aria-pressed') === 'true'
        || cls.indexOf('Active') !== -1
        || cls.indexOf('active') !== -1;
      var rightArea = document.querySelector('[class*="layout__area--right"]');
      var sidebarOpen = !!(rightArea && rightArea.offsetWidth > 50);
      var isOpen = isActive && sidebarOpen;
      if (!isOpen) { btn.click(); return { clicked: true }; }
      return { clicked: false };
    })()
  `);

  if (result?.error) throw new Error(result.error);

  if (result?.clicked) {
    const opened = await evaluateAsync(`
      new Promise(function(resolve) {
        var start = Date.now();
        (function poll() {
          var rightArea = document.querySelector('[class*="layout__area--right"]');
          if (rightArea && rightArea.offsetWidth > 50) return resolve(true);
          if (Date.now() - start >= 2000) return resolve(false);
          setTimeout(poll, 100);
        })();
      })
    `);
    if (!opened) throw new Error('Watchlist panel did not open within timeout');
  }
}

export async function add({ symbol, _deps }) {
  const { evaluate, evaluateAsync } = _resolve(_deps);
  // Use keyboard shortcut to open symbol search in watchlist, type symbol, press Enter
  const c = await getClient();

  // Ensure the watchlist panel is open (helper polls until the sidebar is visible).
  await _ensureWatchlistOpen(evaluate, evaluateAsync);

  // Click the "Add symbol" button (various selectors)
  const addClicked = await evaluate(`
    (function() {
      var selectors = [
        '[data-name="add-symbol-button"]',
        '[aria-label="Add symbol"]',
        '[aria-label*="Add symbol"]',
        'button[class*="addSymbol"]',
      ];
      for (var s = 0; s < selectors.length; s++) {
        var btn = document.querySelector(selectors[s]);
        if (btn && btn.offsetParent !== null) { btn.click(); return { found: true, selector: selectors[s] }; }
      }
      // Fallback: find + button in right panel
      var container = document.querySelector('[class*="layout__area--right"]');
      if (container) {
        var buttons = container.querySelectorAll('button');
        for (var i = 0; i < buttons.length; i++) {
          var ariaLabel = buttons[i].getAttribute('aria-label') || '';
          if (/add.*symbol/i.test(ariaLabel) || buttons[i].textContent.trim() === '+') {
            buttons[i].click();
            return { found: true, method: 'fallback' };
          }
        }
      }
      return { found: false };
    })()
  `);

  if (!addClicked?.found) throw new Error('Add symbol button not found in watchlist panel');
  await new Promise(r => setTimeout(r, 300));

  // Type the symbol into the search input
  await c.Input.insertText({ text: symbol });
  await new Promise(r => setTimeout(r, 500));

  // Press Enter to select the first result
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Enter', code: 'Enter' });
  await new Promise(r => setTimeout(r, 300));

  // Press Escape to close search
  await c.Input.dispatchKeyEvent({ type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await c.Input.dispatchKeyEvent({ type: 'keyUp', key: 'Escape', code: 'Escape' });

  return { success: true, symbol, action: 'added' };
}

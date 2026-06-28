/**
 * Core alert logic.
 */
import { evaluate as _evaluate, evaluateAsync as _evaluateAsync, getClient, safeString } from '../connection.js';
import { makeResolver } from './_resolve.js';
import { restFromRenderer, assertRestEnabled } from './_rest.js';

const _resolve = makeResolver(['evaluate', 'evaluateAsync']);

export async function create({ condition, price, message, _deps }) {
  const { evaluate } = _resolve(_deps);
  const opened = await evaluate(`
    (function() {
      var btn = document.querySelector('[aria-label="Create Alert"]')
        || document.querySelector('[data-name="alerts"]');
      if (btn) { btn.click(); return true; }
      return false;
    })()
  `);

  if (!opened) {
    const client = await getClient();
    await client.Input.dispatchKeyEvent({ type: 'keyDown', modifiers: 1, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await client.Input.dispatchKeyEvent({ type: 'keyUp', key: 'a', code: 'KeyA' });
  }

  await new Promise(r => setTimeout(r, 1000));

  const priceSet = await evaluate(`
    (function() {
      var inputs = document.querySelectorAll('[class*="alert"] input[type="text"], [class*="alert"] input[type="number"]');
      for (var i = 0; i < inputs.length; i++) {
        var label = inputs[i].closest('[class*="row"]')?.querySelector('[class*="label"]');
        if (label && /value|price/i.test(label.textContent)) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          nativeSet.call(inputs[i], ${safeString(String(price))});
          inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
          inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
      if (inputs.length > 0) {
        var nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        nativeSet.call(inputs[0], ${safeString(String(price))});
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      return false;
    })()
  `);

  if (message) {
    await evaluate(`
      (function() {
        var textarea = document.querySelector('[class*="alert"] textarea')
          || document.querySelector('textarea[placeholder*="message"]');
        if (textarea) {
          var nativeSet = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          nativeSet.call(textarea, ${JSON.stringify(message)});
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
  }

  await new Promise(r => setTimeout(r, 500));
  const created = await evaluate(`
    (function() {
      var btns = document.querySelectorAll('button[data-name="submit"], button');
      for (var i = 0; i < btns.length; i++) {
        if (/^create$/i.test(btns[i].textContent.trim())) { btns[i].click(); return true; }
      }
      return false;
    })()
  `);

  return { success: !!created, price, condition, message: message || '(none)', price_set: !!priceSet, source: 'dom_fallback' };
}

export async function list({ _deps } = {}) {
  const { evaluateAsync } = _resolve(_deps);

  // assertRestEnabled BEFORE try/catch so REST_DISABLED always propagates to caller.
  assertRestEnabled('alert_list');

  const url = 'https://pricealerts.tradingview.com/list_alerts';

  try {
    const data = await restFromRenderer(evaluateAsync, url);

    // Node-side validation (data.s and data.r check).
    if (!data || data.s !== 'ok' || !Array.isArray(data.r)) {
      return {
        success: true,
        source: 'rest_api',
        alert_count: 0,
        alerts: [],
        error: (data && data.errmsg) || 'Unexpected response from alerts API',
      };
    }

    const alerts = data.r.map((a) => {
      let sym = a.symbol;
      // symbol may be JSON-encoded: '={"type":"symbol","symbol":"AAPL"}'
      if (typeof sym === 'string' && sym.startsWith('=')) {
        try { sym = JSON.parse(sym.slice(1)).symbol || sym; } catch (_) {}
      }
      return {
        alert_id: a.alert_id,
        symbol: sym,
        type: a.type,
        message: a.message,
        active: a.active,
        condition: a.condition,
        resolution: a.resolution,
        created: a.create_time,
        last_fired: a.last_fire_time,
        expiration: a.expiration,
      };
    });

    return { success: true, source: 'rest_api', alert_count: alerts.length, alerts };
  } catch (err) {
    // restFromRenderer throws TvError(REST_HTTP) on non-2xx; map to soft-failure shape.
    // assertRestEnabled already ran above so REST_DISABLED would have thrown before reaching here.
    return { success: true, source: 'rest_api', alert_count: 0, alerts: [], error: err.message };
  }
}

export async function deleteAlerts({ delete_all, _deps }) {
  const { evaluate } = _resolve(_deps);
  if (delete_all) {
    const result = await evaluate(`
      (function() {
        var alertBtn = document.querySelector('[data-name="alerts"]');
        if (alertBtn) alertBtn.click();
        var header = document.querySelector('[data-name="alerts"]');
        if (header) {
          header.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 }));
          return { context_menu_opened: true };
        }
        return { context_menu_opened: false };
      })()
    `);
    return { success: true, note: 'Alert deletion requires manual confirmation in the context menu.', context_menu_opened: result?.context_menu_opened || false, source: 'dom_fallback' };
  }
  throw new Error('Individual alert deletion not yet supported. Use delete_all: true.');
}

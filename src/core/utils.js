/**
 * Cross-cutting core utilities shared across modules.
 */

/**
 * Coerce a flexible date input into a unix timestamp.
 *
 * Backward-compatible rules (do not change without care — legacy callers depend on these):
 *  - number            → passed through unchanged (already unix seconds/ms, caller's responsibility).
 *  - numeric string    → converted via Number() and passed through (e.g. "1736899200000"),
 *                        even if it represents an absurd date. This preserves pre-existing
 *                        digit-string behavior in scrollToDate/setVisibleRange.
 *  - ISO-8601 string   → parsed via `new Date()` and converted to unix SECONDS
 *                        (e.g. "2025-01-15" → 1736899200).
 *  - invalid date      → returns NaN (callers MUST check).
 *
 * @param {string|number} val
 * @returns {number} unix timestamp (or NaN if unparseable)
 */
export function isoToUnix(val) {
  if (typeof val === 'number') return val;
  const n = Number(val);
  if (!isNaN(n)) return n;
  return Math.floor(new Date(String(val)).getTime() / 1000);
}

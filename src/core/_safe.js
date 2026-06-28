// src/core/_safe.js
//
// CDP injection-safety helpers. Self-contained — no imports.
// Any user value interpolated into an evaluate() expression string MUST go
// through safeString() (string → escaped JS literal) or requireFinite()
// (number validation). safeRegex() escapes a string for use inside a RegExp.

/**
 * Sanitize a string for safe interpolation into JavaScript code evaluated via CDP.
 * Uses JSON.stringify to produce a properly escaped JS string literal (with quotes).
 * Prevents injection via quotes, backticks, template literals, or control chars.
 * Returns a quoted JS string literal: safeString('a"b') → '"a\\"b"'
 */
export function safeString(str) {
  return JSON.stringify(String(str));
}

/**
 * Validate that a value is a finite number. Throws if NaN, Infinity, or non-numeric.
 * Prevents corrupt values from reaching TradingView APIs that persist to cloud state.
 */
export function requireFinite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a finite number, got: ${value}`);
  return n;
}

/**
 * Escape a string so it can be embedded as a literal inside a RegExp.
 * Escapes all regex metacharacters; returns the raw escaped string (no delimiters).
 * safeRegex('a.b*c') → 'a\\.b\\*c'
 */
export function safeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

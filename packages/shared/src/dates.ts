/**
 * Parse a datetime string stored by SQLite or `Date.toISOString()` into a Date.
 * SQLite's `datetime('now')` returns `'YYYY-MM-DD HH:MM:SS'` (UTC, no zone
 * designator); `toISOString()` returns a string ending in `Z`. Both should be
 * interpreted as UTC.
 */
export function parseStoredDate(value: string): Date {
  const hasZone = /[Zz]|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasZone ? value : value + "Z");
}

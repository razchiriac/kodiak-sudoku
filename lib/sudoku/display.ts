/**
 * RAZ-110: Zero-Based Mode display utilities.
 *
 * The internal representation of digits is always 1–9 throughout the
 * solver, store, DB, and leaderboard layers. Only the presentation layer
 * (cell values, note marks, number-pad labels, keyboard input) is
 * transformed when the player opts into zero-based mode.
 *
 * Rules:
 *   normal mode : 1–9 displayed as "1"–"9", keys "1"–"9" accepted
 *   zero-based  : 1–9 displayed as "0"–"8", keys "0"–"8" accepted
 */

/**
 * Returns the display string for an internal digit (1–9).
 * Callers pass 0 (empty cell sentinel) through unchanged — it never
 * hits the display layer anyway because the cell renders nothing for 0.
 */
export function displayDigit(n: number, zeroBased: boolean): string {
  return zeroBased ? String(n - 1) : String(n);
}

/**
 * Parses a keyboard `key` string into an internal digit (1–9), or null
 * if the key is not a valid digit input for the current mode.
 *
 *   normal mode : "1"–"9" → 1–9
 *   zero-based  : "0"–"8" → 1–9
 *
 * "0" in normal mode is intentionally excluded here — the caller should
 * handle it via `isEraseKey` instead (existing behaviour: 0 → erase).
 */
export function parseInputDigit(key: string, zeroBased: boolean): number | null {
  const n = parseInt(key, 10);
  if (isNaN(n)) return null;
  if (zeroBased) {
    return n >= 0 && n <= 8 ? n + 1 : null;
  }
  return n >= 1 && n <= 9 ? n : null;
}

/**
 * Returns true when the key should trigger the erase action.
 *
 * Backspace and Delete always erase. In normal mode "0" also erases
 * (preserving the existing shortcut). In zero-based mode "9" is the
 * natural analogue of "0" in normal mode (the digit with no placement
 * meaning), but we intentionally do NOT auto-erase on "9" to avoid
 * a surprising muscle-memory footgun — the player can use Backspace.
 */
export function isEraseKey(key: string, zeroBased: boolean): boolean {
  if (key === "Backspace" || key === "Delete") return true;
  if (!zeroBased && key === "0") return true;
  return false;
}

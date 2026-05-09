// RAZ-116: Symbol set definitions for Color Code Mode.
//
// Each set maps the nine internal digits (1–9) to a visual
// representation. The engine, store, DB, and leaderboards are
// unaffected — only the presentation layer swaps the glyph.
//
// Four modes:
//   "digits"      – classic 1–9 (default, pass-through)
//   "colors"      – nine colored filled circles (no text)
//   "shapes"      – nine Unicode shapes (monochrome)
//   "colorShapes" – colored shapes (safest for colorblind users)
//
// Framework-free — no React. The Cell and NumberPad components
// consume SymbolDef to decide what to render.

export type SymbolSetId = "digits" | "colors" | "shapes" | "colorShapes";

export const SYMBOL_SET_IDS: readonly SymbolSetId[] = [
  "digits",
  "colors",
  "shapes",
  "colorShapes",
] as const;

export const SYMBOL_SET_LABEL: Record<SymbolSetId, string> = {
  digits: "Digits (1–9)",
  colors: "Colors",
  shapes: "Shapes",
  colorShapes: "Colors + Shapes",
};

export type SymbolDef = {
  /** Internal digit 1–9. */
  value: number;
  /** Unicode glyph to display (empty string for pure-color mode). */
  glyph: string;
  /** CSS color for the symbol. Null means use the default text color. */
  color: string | null;
  /** Accessible label for screen readers (e.g. "red circle"). */
  ariaLabel: string;
};

// Nine distinct hues chosen for maximum separability. The "colors"
// set uses Okabe-Ito-inspired values that remain distinguishable
// under the most common forms of color vision deficiency.
const COLORS = [
  "#e64553", // vermillion (red)
  "#f28c28", // orange
  "#e9c46a", // amber/yellow
  "#2a9d8f", // teal
  "#3b82f6", // blue
  "#7c3aed", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#78716c", // warm gray (brown substitute — higher contrast)
] as const;

const COLOR_NAMES = [
  "red", "orange", "yellow", "teal", "blue",
  "violet", "pink", "cyan", "gray",
] as const;

const SHAPE_GLYPHS = [
  "●", "■", "▲", "◆", "★", "⬡", "✚", "⬟", "♥",
] as const;

const SHAPE_NAMES = [
  "circle", "square", "triangle", "diamond", "star",
  "hexagon", "cross", "pentagon", "heart",
] as const;

function buildDigits(): SymbolDef[] {
  return Array.from({ length: 9 }, (_, i) => ({
    value: i + 1,
    glyph: String(i + 1),
    color: null,
    ariaLabel: String(i + 1),
  }));
}

function buildColors(): SymbolDef[] {
  return Array.from({ length: 9 }, (_, i) => ({
    value: i + 1,
    glyph: "●",
    color: COLORS[i],
    ariaLabel: COLOR_NAMES[i],
  }));
}

function buildShapes(): SymbolDef[] {
  return Array.from({ length: 9 }, (_, i) => ({
    value: i + 1,
    glyph: SHAPE_GLYPHS[i],
    color: null,
    ariaLabel: SHAPE_NAMES[i],
  }));
}

function buildColorShapes(): SymbolDef[] {
  return Array.from({ length: 9 }, (_, i) => ({
    value: i + 1,
    glyph: SHAPE_GLYPHS[i],
    color: COLORS[i],
    ariaLabel: `${COLOR_NAMES[i]} ${SHAPE_NAMES[i]}`,
  }));
}

// Pre-built sets, indexed 1–9 (index 0 is a dummy for the "empty"
// sentinel). Consumers call `getSymbol(digit, setId)`.
const SETS: Record<SymbolSetId, SymbolDef[]> = {
  digits: buildDigits(),
  colors: buildColors(),
  shapes: buildShapes(),
  colorShapes: buildColorShapes(),
};

/**
 * Returns the symbol definition for an internal digit (1–9) in the
 * given symbol set. Returns null for digit 0 (empty cell sentinel).
 */
export function getSymbol(
  digit: number,
  setId: SymbolSetId,
): SymbolDef | null {
  if (digit < 1 || digit > 9) return null;
  return SETS[setId][digit - 1];
}

/**
 * Returns the display label for an internal digit in the given set.
 * Used by the number pad and aria-labels. Falls back to the digit
 * string for "digits" mode.
 */
export function symbolLabel(digit: number, setId: SymbolSetId): string {
  const sym = getSymbol(digit, setId);
  return sym?.ariaLabel ?? String(digit);
}

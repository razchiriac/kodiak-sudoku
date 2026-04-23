// RAZ-9 — React-PDF document for the printable puzzle handout.
// Renders a 9x9 grid with thick 3x3 box borders, optionally overlaid
// with pencil marks drawn as a 3x3 sub-grid inside each empty cell.
//
// Why @react-pdf/renderer
//   The project's policy is "ship one new dep per ticket when the
//   alternative is >50 lines of hand-rolled PDF bytes." A 9x9 grid
//   is trivially expressible in raw PDF text but the sub-cell pencil
//   marks, font-metrics, centered text, and auto-sizing all become
//   fiddly fast. React-PDF keeps the component declarative and gives
//   us Flexbox-style layout the same way the rest of the app does it.
//
// Layout (A4 portrait, 595 x 842 pt):
//   top margin    40
//   header        ~70  (title + meta line)
//   grid square   515 x 515  (edge-to-edge within 40pt side margins)
//   footer        ~30  (URL tagline)
//   bottom        remaining — we deliberately leave whitespace so a
//                 player can jot notes below the board.

import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from "@react-pdf/renderer";
import {
  BOARD_SIZE,
  GRID_DIM,
  buildFixedMask,
  computeAllCandidates,
  parseBoard,
  type Notes,
} from "@/lib/sudoku/board";

// Pencil-mark mode is a plain string union because React-PDF props
// are serialized/deserialized through the renderer and enum-shaped
// maps would add noise here without any callsite win.
export type PencilMarks =
  | { kind: "none" }
  // Template: auto-computed candidates given the current board.
  // Useful for players who want a pre-pruned grid to start from.
  | { kind: "template" }
  // Player's manually-curated notes. The route handler decodes the
  // b64 notes payload and passes the raw Uint16Array here so this
  // module stays pure (no base64 dance at render time).
  | { kind: "custom"; notes: Notes };

export type PuzzleDocProps = {
  // The 81-char digit string to render as the grid content. When
  // `mode === "progress"`, this is the player's current board
  // (clues + placements); when `mode === "original"`, it's the
  // untouched puzzle column from the DB. Either way the grid just
  // renders whatever is here — branching happens upstream.
  puzzle: string;
  // `fixedPuzzle` is the ORIGINAL puzzle string used to derive which
  // cells are clues. Always the clue set even when `puzzle` is the
  // current progress — we need this to render clues in a heavier
  // weight so teachers / print players can still tell them apart
  // after filling in the rest.
  fixedPuzzle: string;
  marks: PencilMarks;
  // Title and meta text rendered in the header. Kept as plain strings
  // so callers (route handler) own all formatting decisions (date,
  // difficulty label, etc).
  title: string;
  meta: string;
};

// Design tokens. A4 = 595 x 842 pt at 72 DPI.
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const GRID_SIZE = PAGE_W - MARGIN * 2; // 515
const CELL_SIZE = GRID_SIZE / GRID_DIM; // ~57.2
// Pencil-mark sub-cells are sized via flex (see styles below) so we
// don't need an explicit constant here. Documented for future
// layout tweaks: each sub-cell is CELL_SIZE / 3 ≈ 19pt tall.

const styles = StyleSheet.create({
  page: {
    paddingTop: MARGIN,
    paddingLeft: MARGIN,
    paddingRight: MARGIN,
    paddingBottom: MARGIN,
    backgroundColor: "#ffffff",
    fontFamily: "Helvetica",
    color: "#000000",
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },
  meta: {
    fontSize: 10,
    color: "#555555",
  },
  grid: {
    width: GRID_SIZE,
    height: GRID_SIZE,
    borderWidth: 1.6,
    borderColor: "#000000",
    // React-PDF defaults flexDirection to "column". The grid is a
    // column of 9 rows; each row is a row of 9 cells.
    flexDirection: "column",
  },
  row: {
    flexDirection: "row",
    // The outermost grid border provides the top/bottom edges; each
    // row below the first draws its own top border. We explicitly
    // skip the first row's top border in the component to avoid a
    // double-weight seam at the top of the grid.
    height: CELL_SIZE,
  },
  cell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    // Base 1x1 grid. Thick box borders (every 3rd line) are applied
    // by overriding borderLeft/borderTop at the specific cells below.
    borderRightWidth: 0.4,
    borderBottomWidth: 0.4,
    borderColor: "#000000",
    // Center the clue text.
    alignItems: "center",
    justifyContent: "center",
    // Pencil marks are absolutely positioned children so they don't
    // push the clue text around. Main cell is relative by default.
  },
  clue: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
  },
  placed: {
    // "My progress" placements are rendered lighter so the print-out
    // still reads as a puzzle (clues dominate). Helpful when a player
    // wants to hand someone a half-solved grid to finish.
    fontSize: 22,
    fontFamily: "Helvetica",
    color: "#444444",
  },
  notesGrid: {
    position: "absolute",
    top: 2,
    left: 2,
    right: 2,
    bottom: 2,
    flexDirection: "column",
  },
  notesRow: {
    flex: 1,
    flexDirection: "row",
  },
  notesCell: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  notesDigit: {
    // Pencil-mark size. Small enough that 3 digits fit on one row but
    // large enough to still read on a printed A4.
    fontSize: 7,
    color: "#777777",
  },
  footer: {
    marginTop: 20,
    fontSize: 9,
    color: "#777777",
  },
});

// Render a single 3x3 sub-grid of pencil-mark digits for one cell.
// Cells with zero candidates render nothing (saves a bit of draw
// time — React-PDF emits every <Text> as a PDF op).
function NotesOverlay({ mask }: { mask: number }) {
  if (!mask) return null;
  // Flattened 3x3 layout: digits 1..9 map to positions
  //   1 2 3
  //   4 5 6
  //   7 8 9
  // in row-major order.
  const rows: number[][] = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
  ];
  return (
    <View style={styles.notesGrid}>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.notesRow}>
          {row.map((d) => {
            const has = (mask & (1 << (d - 1))) !== 0;
            return (
              <View key={d} style={styles.notesCell}>
                {has ? <Text style={styles.notesDigit}>{d}</Text> : null}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// Border-weight overrides for the 3x3 box structure. Returns the
// extra style for a given cell index: thick left for col % 3 === 0
// (except the outermost, which the grid border covers), thick top
// for row % 3 === 0 similarly. We use dedicated properties (rather
// than overriding the whole borderColor/Width) so they composite
// cleanly with the base cell style.
function cellBoxStyles(row: number, col: number) {
  const extra: Record<string, number | string> = {};
  if (col > 0 && col % 3 === 0) {
    extra.borderLeftWidth = 1.2;
    extra.borderLeftColor = "#000000";
  }
  if (row > 0 && row % 3 === 0) {
    extra.borderTopWidth = 1.2;
    extra.borderTopColor = "#000000";
  }
  return extra;
}

export function PuzzleDoc({
  puzzle,
  fixedPuzzle,
  marks,
  title,
  meta,
}: PuzzleDocProps) {
  // Derive once so the render loop stays a pure function of indices.
  // buildFixedMask parses the ORIGINAL puzzle string (not the current
  // progress) so that clue vs placement styling is stable regardless
  // of which board-content mode the player picked.
  const fixedMask = buildFixedMask(fixedPuzzle);
  const board = parseBoard(puzzle);
  // Compute pencil-mark payload once. The "template" branch solves a
  // lot more work than the "none"/"custom" branches, but it runs in
  // under 1ms for a single 9x9 grid so no memoization needed.
  const notes: Notes | null =
    marks.kind === "template"
      ? computeAllCandidates(board)
      : marks.kind === "custom"
        ? marks.notes
        : null;

  const rows: number[] = [];
  for (let r = 0; r < GRID_DIM; r++) rows.push(r);
  const cols: number[] = [];
  for (let c = 0; c < GRID_DIM; c++) cols.push(c);

  return (
    <Document title={title}>
      <Page size={{ width: PAGE_W, height: PAGE_H }} style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta}>{meta}</Text>
        </View>

        <View style={styles.grid}>
          {rows.map((r) => (
            <View key={r} style={styles.row}>
              {cols.map((c) => {
                const i = r * GRID_DIM + c;
                const digit = board[i];
                const isFixed = fixedMask[i] === 1;
                const cellExtra = cellBoxStyles(r, c);
                // Trim right/bottom borders on the last column/row —
                // the outer grid border owns those edges.
                if (c === GRID_DIM - 1) cellExtra.borderRightWidth = 0;
                if (r === GRID_DIM - 1) cellExtra.borderBottomWidth = 0;
                const showNote = notes && digit === 0;
                return (
                  <View key={c} style={[styles.cell, cellExtra]}>
                    {digit !== 0 ? (
                      <Text style={isFixed ? styles.clue : styles.placed}>
                        {digit}
                      </Text>
                    ) : null}
                    {showNote ? <NotesOverlay mask={notes[i]} /> : null}
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <Text style={styles.footer}>
          Generated by Kodiak Sudoku · sudoku-mauve-nine.vercel.app
        </Text>
      </Page>
    </Document>
  );
}

// Tiny guard used by the route handler to validate the `puzzle`
// string before we hand it to React-PDF (which would otherwise throw
// deep inside its layout engine and produce an ugly 500).
export function isValidPuzzleString(str: string): boolean {
  if (typeof str !== "string") return false;
  if (str.length !== BOARD_SIZE) return false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch !== "0" && ch !== "." && (ch < "1" || ch > "9")) return false;
  }
  return true;
}

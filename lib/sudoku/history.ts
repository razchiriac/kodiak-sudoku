import { type CellIndex, type Digit } from "./board";

// One reversible step in the player's edit history. We store both the
// previous and next value so undo and redo are symmetric and we never need
// to re-derive state by replaying from the start.
export type HistoryEntry =
  | {
      kind: "value";
      index: CellIndex;
      prevValue: Digit;
      nextValue: Digit;
      // Snapshot of the cell's notes mask before the value was placed, so
      // an undo can restore notes that were auto-cleared on placement.
      prevNotesMask: number;
    }
  | {
      kind: "note";
      index: CellIndex;
      prevMask: number;
      nextMask: number;
    };

const MAX_ENTRIES = 200;

export type History = {
  past: HistoryEntry[];
  future: HistoryEntry[];
};

export function emptyHistory(): History {
  return { past: [], future: [] };
}

// Push a new entry. Drops the oldest if we exceed MAX_ENTRIES so memory
// stays bounded over a long session. Always clears the redo stack because
// a new edit invalidates any previously undone edits (standard editor
// semantics).
export function pushEntry(history: History, entry: HistoryEntry): History {
  const past = [...history.past, entry];
  if (past.length > MAX_ENTRIES) past.shift();
  return { past, future: [] };
}

// Pop the most recent entry off the past stack and place it on the future
// stack so it can be redone. Returns the entry to apply (callers must
// invert it themselves) plus the new history.
export function undo(history: History): { entry: HistoryEntry; next: History } | null {
  const last = history.past[history.past.length - 1];
  if (!last) return null;
  return {
    entry: last,
    next: {
      past: history.past.slice(0, -1),
      future: [...history.future, last],
    },
  };
}

export function redo(history: History): { entry: HistoryEntry; next: History } | null {
  const last = history.future[history.future.length - 1];
  if (!last) return null;
  return {
    entry: last,
    next: {
      past: [...history.past, last],
      future: history.future.slice(0, -1),
    },
  };
}

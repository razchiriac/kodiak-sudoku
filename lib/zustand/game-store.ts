"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  BOARD_SIZE,
  buildFixedMask,
  clearCellNotes,
  computeAllCandidates,
  digitCounts,
  emptyNotes,
  parseBoard,
  prunePeerNotes,
  toggleNote,
} from "@/lib/sudoku/board";
import { findConflicts, isComplete, isLegalPlacement } from "@/lib/sudoku/validate";
import { nextHint } from "@/lib/sudoku/solver";
import {
  emptyHistory,
  pushEntry,
  redo,
  undo,
  type HistoryEntry,
} from "@/lib/sudoku/history";
import { decodeNotes, encodeNotes } from "@/lib/sudoku/notes-codec";

// Single Zustand store that owns ALL transient gameplay state. UI
// components subscribe to slices of this store; nothing about the game
// lives in React state so undo/redo and autosave are simple.
//
// We use `Uint8Array` and `Uint16Array` for board/notes because:
//   1) per-cell mutations are O(1) and allocation-free, and
//   2) cloning for history entries is cheap (162 bytes per board).
// React still re-renders correctly because each setter creates a fresh
// typed array reference.

export type GameMode = "value" | "notes";

export type GameMeta = {
  puzzleId: number;
  difficultyBucket: number;
  // 'random' or 'daily'. Determines submission rules and where the
  // completion is recorded. Stored in the store so the completion modal
  // can render the right CTA without prop-drilling.
  mode: "random" | "daily";
  // Solution for client-side hints. NULL for daily puzzles where the
  // server keeps the solution private.
  solution: string | null;
};

export type GameSnapshot = {
  meta: GameMeta;
  board: string;
  notesB64: string;
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  isPaused: boolean;
  isComplete: boolean;
  startedAt: number;
};

type GameState = {
  meta: GameMeta | null;
  // Original puzzle string (with zeros for blanks). Used to derive the
  // fixed mask and to reset the board.
  puzzle: string;
  board: Uint8Array;
  fixed: Uint8Array;
  notes: Uint16Array;
  selection: number | null;
  mode: GameMode;
  history: ReturnType<typeof emptyHistory>;
  conflicts: Set<number>;
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  isPaused: boolean;
  isComplete: boolean;
  // Wall-clock timestamp when the game started. Combined with elapsedMs
  // it lets us validate server-side that the user did not somehow submit
  // a faster time than physically possible.
  startedAt: number;
  // Settings the player can flip in the UI. Defaults are conservative.
  settings: {
    strict: boolean;
    highlightSameDigit: boolean;
  };
};

type GameActions = {
  // Initialize a new game from a fresh puzzle. Resets all transient state.
  startGame: (args: { meta: GameMeta; puzzle: string }) => void;
  // Resume a saved game from a server snapshot.
  resumeFromSnapshot: (snapshot: GameSnapshot, puzzle: string) => void;
  // Snapshot for autosave / completion submission.
  snapshot: () => GameSnapshot | null;

  selectCell: (index: number | null) => void;
  moveSelection: (dx: number, dy: number) => void;
  setMode: (mode: GameMode) => void;
  toggleMode: () => void;

  inputDigit: (digit: number) => void;
  eraseSelection: () => void;
  // Replace every empty cell's notes with the full set of legal
  // candidates (1..9 minus peers' values). Pushes a single bulk
  // history entry so one undo reverts the whole operation.
  autoFillNotes: () => void;

  undo: () => void;
  redo: () => void;

  hint: () => Promise<void>;
  // Request a hint from the server (for daily puzzles where we don't have
  // the solution client-side). Caller injects the fetcher so the store
  // stays framework-agnostic.
  setRemoteHintFetcher: (
    fn: (board: string, selected: number | null) => Promise<{ index: number; digit: number }>,
  ) => void;

  togglePause: () => void;
  tick: (ms: number) => void;

  setSetting: <K extends keyof GameState["settings"]>(
    key: K,
    value: GameState["settings"][K],
  ) => void;

  // Returns counts for digits 1..9 currently placed on the board. Used by
  // the number pad to show "remaining" badges.
  getDigitCounts: () => number[];
};

const INITIAL: GameState = {
  meta: null,
  puzzle: "",
  board: new Uint8Array(BOARD_SIZE),
  fixed: new Uint8Array(BOARD_SIZE),
  notes: emptyNotes(),
  selection: null,
  mode: "value",
  history: emptyHistory(),
  conflicts: new Set(),
  elapsedMs: 0,
  mistakes: 0,
  hintsUsed: 0,
  isPaused: false,
  isComplete: false,
  startedAt: 0,
  settings: {
    strict: false,
    highlightSameDigit: true,
  },
};

let remoteHintFetcher:
  | ((board: string, selected: number | null) => Promise<{ index: number; digit: number }>)
  | null = null;

export const useGameStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      startGame: ({ meta, puzzle }) => {
        const board = parseBoard(puzzle);
        const fixed = buildFixedMask(puzzle);
        set({
          ...INITIAL,
          meta,
          puzzle,
          board,
          fixed,
          notes: emptyNotes(),
          selection: null,
          history: emptyHistory(),
          conflicts: new Set(),
          startedAt: Date.now(),
          settings: get().settings, // preserve user prefs across games
        });
      },

      resumeFromSnapshot: (snapshot, puzzle) => {
        const fixed = buildFixedMask(puzzle);
        const board = parseBoard(snapshot.board);
        const notes = decodeNotes(snapshot.notesB64);
        set({
          ...INITIAL,
          meta: snapshot.meta,
          puzzle,
          board,
          fixed,
          notes,
          elapsedMs: snapshot.elapsedMs,
          mistakes: snapshot.mistakes,
          hintsUsed: snapshot.hintsUsed,
          isPaused: snapshot.isPaused,
          isComplete: snapshot.isComplete,
          startedAt: snapshot.startedAt,
          settings: get().settings,
        });
        set((s) => ({ ...s, conflicts: findConflicts(s.board) }));
      },

      snapshot: () => {
        const s = get();
        if (!s.meta) return null;
        return {
          meta: s.meta,
          board: Array.from(s.board).join(""),
          notesB64: encodeNotes(s.notes),
          elapsedMs: s.elapsedMs,
          mistakes: s.mistakes,
          hintsUsed: s.hintsUsed,
          isPaused: s.isPaused,
          isComplete: s.isComplete,
          startedAt: s.startedAt,
        };
      },

      selectCell: (index) => set({ selection: index }),

      moveSelection: (dx, dy) => {
        const s = get();
        const cur = s.selection ?? 40; // center
        const row = Math.floor(cur / 9);
        const col = cur % 9;
        const nr = (row + dy + 9) % 9;
        const nc = (col + dx + 9) % 9;
        set({ selection: nr * 9 + nc });
      },

      setMode: (mode) => set({ mode }),
      toggleMode: () => set((s) => ({ mode: s.mode === "value" ? "notes" : "value" })),

      inputDigit: (digit) => {
        const s = get();
        if (s.isComplete || s.isPaused) return;
        const idx = s.selection;
        if (idx == null) return;
        if (s.fixed[idx]) return; // never overwrite a clue
        if (digit < 1 || digit > 9) return;

        if (s.mode === "notes") {
          // Only allow notes on empty cells; placing a value should clear
          // notes but flipping a note in a filled cell is meaningless.
          if (s.board[idx] !== 0) return;
          const prevMask = s.notes[idx];
          const nextNotes = toggleNote(s.notes, idx, digit);
          const entry: HistoryEntry = {
            kind: "note",
            index: idx,
            prevMask,
            nextMask: nextNotes[idx],
          };
          set({ notes: nextNotes, history: pushEntry(s.history, entry) });
          return;
        }

        // Value mode: maybe block if strict + illegal.
        if (s.settings.strict && !isLegalPlacement(s.board, idx, digit)) return;

        const prevValue = s.board[idx];
        if (prevValue === digit) return; // no-op
        const board = new Uint8Array(s.board);
        board[idx] = digit;

        // Snapshot the full notes buffer before mutation so the history
        // entry can restore it verbatim on undo. We need the snapshot
        // BEFORE clearCellNotes / prunePeerNotes because both return new
        // buffers but we want the original state for undo.
        const prevNotes = new Uint16Array(s.notes);

        // Clear notes on the cell we just filled, then prune the newly
        // placed digit from every peer's notes. Pruning is now
        // unconditional: placing a digit always invalidates that digit
        // as a candidate in its row, column, and box.
        let notes = clearCellNotes(s.notes, idx);
        notes = prunePeerNotes(notes, idx, digit);

        // Increment mistakes if the placement creates a conflict. We use
        // the local validator because it's instant and the server check
        // at completion is the source of truth for correctness.
        let mistakes = s.mistakes;
        if (!isLegalPlacement(s.board, idx, digit)) mistakes++;

        const entry: HistoryEntry = {
          kind: "value",
          index: idx,
          prevValue,
          nextValue: digit,
          prevNotes,
          // notes is already a fresh buffer from clearCellNotes/prune,
          // so we can keep the reference. The store never mutates it.
          nextNotes: notes,
        };
        const next = {
          ...s,
          board,
          notes,
          mistakes,
          history: pushEntry(s.history, entry),
        };
        set({
          ...next,
          conflicts: findConflicts(next.board),
          isComplete: isComplete(next.board),
        });
      },

      eraseSelection: () => {
        const s = get();
        if (s.isComplete || s.isPaused) return;
        const idx = s.selection;
        if (idx == null) return;
        if (s.fixed[idx]) return;
        const prevValue = s.board[idx];
        const prevMask = s.notes[idx];
        if (prevValue === 0 && prevMask === 0) return;

        const board = new Uint8Array(s.board);
        board[idx] = 0;
        const prevNotes = new Uint16Array(s.notes);
        const notes = clearCellNotes(s.notes, idx);

        // Erase is recorded as a value edit so undo restores both. Erase
        // doesn't touch peer notes — the snapshots only differ in the
        // erased cell — but we use the same buffer-swap entry shape for
        // uniformity with placements.
        const entry: HistoryEntry = {
          kind: "value",
          index: idx,
          prevValue,
          nextValue: 0,
          prevNotes,
          nextNotes: notes,
        };
        set({
          board,
          notes,
          history: pushEntry(s.history, entry),
          conflicts: findConflicts(board),
          isComplete: isComplete(board),
        });
      },

      autoFillNotes: () => {
        const s = get();
        if (s.isComplete || s.isPaused) return;
        // Snapshot the current notes so undo can restore them in one
        // step. We freeze the prev buffer by copying it; computeAll
        // already returns a fresh buffer so nextNotes is safe to keep
        // by reference.
        const prevNotes = new Uint16Array(s.notes);
        const nextNotes = computeAllCandidates(s.board);

        // Skip if nothing actually changed — avoids polluting the undo
        // stack with no-op entries (e.g. tapping the button twice).
        let changed = false;
        for (let i = 0; i < BOARD_SIZE; i++) {
          if (prevNotes[i] !== nextNotes[i]) {
            changed = true;
            break;
          }
        }
        if (!changed) return;

        const entry: HistoryEntry = {
          kind: "notes-bulk",
          prevNotes,
          nextNotes,
        };
        set({ notes: nextNotes, history: pushEntry(s.history, entry) });
      },

      undo: () => {
        const s = get();
        const u = undo(s.history);
        if (!u) return;
        const e = u.entry;
        if (e.kind === "value") {
          const board = new Uint8Array(s.board);
          board[e.index] = e.prevValue;
          // Restore the entire pre-placement notes buffer in one shot.
          // This includes both the placed cell's notes AND any peer
          // candidates that were pruned. Copy so the stored entry stays
          // immutable for redo (same convention as notes-bulk).
          const notes = new Uint16Array(e.prevNotes);
          set({
            board,
            notes,
            history: u.next,
            conflicts: findConflicts(board),
            isComplete: isComplete(board),
            // Lock isComplete back to false if undoing past the win.
          });
        } else if (e.kind === "note") {
          const notes = new Uint16Array(s.notes);
          notes[e.index] = e.prevMask;
          set({ notes, history: u.next });
        } else {
          // notes-bulk: swap the entire notes buffer back. We copy so
          // the stored entry's prevNotes stays immutable for redo.
          set({ notes: new Uint16Array(e.prevNotes), history: u.next });
        }
      },

      redo: () => {
        const s = get();
        const r = redo(s.history);
        if (!r) return;
        const e = r.entry;
        if (e.kind === "value") {
          const board = new Uint8Array(s.board);
          board[e.index] = e.nextValue;
          // Re-apply the post-placement notes buffer wholesale (cleared
          // cell + pruned peers). Copy for the same immutability reason
          // as undo above.
          const notes = new Uint16Array(e.nextNotes);
          set({
            board,
            notes,
            history: r.next,
            conflicts: findConflicts(board),
            isComplete: isComplete(board),
          });
        } else if (e.kind === "note") {
          const notes = new Uint16Array(s.notes);
          notes[e.index] = e.nextMask;
          set({ notes, history: r.next });
        } else {
          // notes-bulk: re-apply the recomputed candidates.
          set({ notes: new Uint16Array(e.nextNotes), history: r.next });
        }
      },

      setRemoteHintFetcher: (fn) => {
        remoteHintFetcher = fn;
      },

      hint: async () => {
        const s = get();
        if (s.isComplete || s.isPaused || !s.meta) return;

        let suggestion: { index: number; digit: number } | null = null;
        if (s.meta.solution) {
          const h = nextHint(s.board, {
            selected: s.selection,
            solution: s.meta.solution,
          });
          if (h) suggestion = { index: h.index, digit: h.digit };
        } else if (remoteHintFetcher) {
          const board = Array.from(s.board).join("");
          try {
            suggestion = await remoteHintFetcher(board, s.selection);
          } catch {
            return;
          }
        }
        if (!suggestion) return;

        // Apply the hint as a normal placement so it appears in undo
        // history and counts toward digit totals.
        const idx = suggestion.index;
        const prevValue = s.board[idx];
        const board = new Uint8Array(s.board);
        board[idx] = suggestion.digit;
        // Same snapshot-then-mutate pattern as inputDigit so undo can
        // restore the full notes buffer (including peer pruning).
        const prevNotes = new Uint16Array(s.notes);
        let notes = clearCellNotes(s.notes, idx);
        notes = prunePeerNotes(notes, idx, suggestion.digit);
        const entry: HistoryEntry = {
          kind: "value",
          index: idx,
          prevValue,
          nextValue: suggestion.digit,
          prevNotes,
          nextNotes: notes,
        };
        set({
          board,
          notes,
          selection: idx,
          hintsUsed: s.hintsUsed + 1,
          history: pushEntry(s.history, entry),
          conflicts: findConflicts(board),
          isComplete: isComplete(board),
        });
      },

      togglePause: () =>
        set((s) => ({
          isPaused: !s.isPaused && !s.isComplete ? true : false,
        })),

      tick: (ms) => {
        const s = get();
        if (s.isPaused || s.isComplete || !s.meta) return;
        set({ elapsedMs: s.elapsedMs + ms });
      },

      setSetting: (key, value) =>
        set((s) => ({ settings: { ...s.settings, [key]: value } })),

      getDigitCounts: () => digitCounts(get().board),
    }),
    {
      name: "sudoku-game",
      // Only persist the settings + the active anonymous game. Server-side
      // resume is the source of truth for signed-in users.
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          // SSR no-op storage prevents crashes during prerender.
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return localStorage;
      }),
      partialize: (s) => ({
        settings: s.settings,
        // Persist current game so anonymous users can refresh without
        // losing progress. Typed arrays serialize to plain objects via
        // JSON; we round-trip them through the snapshot format on load.
        snapshot: s.meta
          ? {
              meta: s.meta,
              board: Array.from(s.board).join(""),
              notesB64: encodeNotes(s.notes),
              elapsedMs: s.elapsedMs,
              mistakes: s.mistakes,
              hintsUsed: s.hintsUsed,
              isPaused: s.isPaused,
              isComplete: s.isComplete,
              startedAt: s.startedAt,
              puzzle: s.puzzle,
            }
          : null,
      }),
      // We don't restore typed arrays from the persisted snapshot here;
      // the play page calls `resumeFromSnapshot` explicitly when it
      // detects a stored game. This keeps the rehydration path simple.
      onRehydrateStorage: () => () => {},
    },
  ),
);

// Read the persisted anonymous snapshot without subscribing to the store.
// Used by the play page to decide whether to offer "Continue".
export function readPersistedSnapshot(): (GameSnapshot & { puzzle: string }) | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("sudoku-game");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { snapshot?: GameSnapshot & { puzzle: string } } };
    return parsed.state?.snapshot ?? null;
  } catch {
    return null;
  }
}

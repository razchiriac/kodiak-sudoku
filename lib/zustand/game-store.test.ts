import { beforeEach, describe, expect, it } from "vitest";
import { useGameStore } from "./game-store";
import { hasNote, peers } from "@/lib/sudoku/board";

// End-to-end test for the smart-notes behavior: placing a digit must
// remove that digit from every peer's notes, and undo must restore
// those peer candidates exactly as they were. These are the user-
// facing invariants that motivated extending the value HistoryEntry
// to carry full notes snapshots.
//
// The store imports run fine in Vitest's node env: the persist
// middleware falls back to no-op storage when `window` is undefined,
// and the "use client" directive is a bundler hint Vitest ignores.

const PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

function start() {
  useGameStore.getState().startGame({
    meta: {
      puzzleId: 1,
      difficultyBucket: 0,
      mode: "random",
      solution: null,
    },
    puzzle: PUZZLE,
  });
}

// Pick the empty (non-fixed) peers of a cell. inputDigit refuses to
// edit notes on a clue cell, so picking peer indices blindly would
// silently no-op on whichever ones happen to be givens in the puzzle.
function emptyPeersOf(target: number): number[] {
  const fixed = useGameStore.getState().fixed;
  return peers(target).filter((p) => fixed[p] === 0);
}

describe("game-store: peer-note pruning on value placement", () => {
  beforeEach(start);

  it("removes the placed digit from every peer's notes", () => {
    // Cell index 2 is empty in the sample puzzle (row 0 col 2). Pick
    // a few of its EMPTY peers and pencil in candidate `5` plus a
    // sibling `3` we expect to be left alone.
    const target = 2;
    const samplePeers = emptyPeersOf(target).slice(0, 3);
    expect(samplePeers.length).toBeGreaterThan(0);

    const { selectCell, toggleMode, inputDigit } = useGameStore.getState();

    toggleMode(); // value -> notes
    for (const p of samplePeers) {
      selectCell(p);
      inputDigit(5);
      // Sibling digit: tells us the prune only touches the placed
      // digit, not the entire mask.
      inputDigit(3);
    }
    toggleMode(); // notes -> value

    selectCell(target);
    inputDigit(5);

    const after = useGameStore.getState().notes;
    for (const p of samplePeers) {
      expect(hasNote(after, p, 5)).toBe(false);
      expect(hasNote(after, p, 3)).toBe(true);
    }
  });

  it("undo restores peer notes that were pruned by the placement", () => {
    const target = 2;
    const samplePeers = emptyPeersOf(target).slice(0, 3);

    const { selectCell, toggleMode, inputDigit, undo } = useGameStore.getState();

    toggleMode();
    for (const p of samplePeers) {
      selectCell(p);
      inputDigit(5);
    }
    toggleMode();

    selectCell(target);
    inputDigit(5);
    // Sanity: peers' `5` was actually pruned before we undo.
    let n = useGameStore.getState().notes;
    for (const p of samplePeers) expect(hasNote(n, p, 5)).toBe(false);

    undo();

    n = useGameStore.getState().notes;
    for (const p of samplePeers) {
      expect(hasNote(n, p, 5)).toBe(true);
    }
    // Board cell goes back to empty too.
    expect(useGameStore.getState().board[target]).toBe(0);
  });

  it("RAZ-17: jump-on-place advances selection to next empty peer when flag+setting are on", () => {
    // Simulate the server having mirrored the feature flag ON and the
    // user having opted into the setting. A placement on `target` with
    // a LEGAL, non-winning value should leave `selection` pointing at
    // the first empty, non-fixed peer of `target` (lowest index in
    // peers(target) that's still empty).
    const target = 2;
    const { selectCell, setSetting, setFeatureFlag, inputDigit, fixed, board } =
      useGameStore.getState();

    // Pick a digit that's legal at `target` for this puzzle. Row 0 of
    // PUZZLE is "530070000", so column 2 is empty and 1 is legal
    // (values present in row are 5, 3, 7).
    const legalDigit = 1;

    setFeatureFlag("jumpOnPlace", true);
    setSetting("jumpOnPlace", true);
    selectCell(target);
    inputDigit(legalDigit);

    const after = useGameStore.getState();
    expect(after.board[target]).toBe(legalDigit);
    expect(after.selection).not.toBe(target);
    // Whatever cell we landed on must itself be empty (and not a clue).
    expect(after.selection).not.toBeNull();
    expect(fixed[after.selection!]).toBe(0);
    expect(board[after.selection!]).toBe(0);
  });

  it("RAZ-17: jump-on-place is a no-op when the setting is off", () => {
    // Feature flag on but the per-user setting is off → selection must
    // stay on `target` after placement.
    const target = 2;
    const { selectCell, setSetting, setFeatureFlag, inputDigit } =
      useGameStore.getState();

    setFeatureFlag("jumpOnPlace", true);
    setSetting("jumpOnPlace", false);
    selectCell(target);
    inputDigit(1);

    expect(useGameStore.getState().selection).toBe(target);
  });

  it("RAZ-17: jump-on-place is a no-op when the flag is off", () => {
    // Belt-and-braces: user opted in but the server flag went off.
    // Selection must stay put so we never ship a setting whose behavior
    // isn't kill-switchable from Edge Config.
    const target = 2;
    const { selectCell, setSetting, setFeatureFlag, inputDigit } =
      useGameStore.getState();

    setFeatureFlag("jumpOnPlace", false);
    setSetting("jumpOnPlace", true);
    selectCell(target);
    inputDigit(1);

    expect(useGameStore.getState().selection).toBe(target);
  });

  it("toggleNoteOnSelection toggles a note while staying in value mode", () => {
    // RAZ-20: long-press path. We simulate the gesture by leaving the
    // store in value mode (the default after startGame) and calling
    // the store action directly — the NumberPad component invokes
    // this exact action from its long-press timer.
    const target = 2;
    const { selectCell, toggleNoteOnSelection, undo } = useGameStore.getState();

    selectCell(target);
    // Mode stays "value" the whole time; toggleNoteOnSelection must
    // not require notes mode.
    expect(useGameStore.getState().mode).toBe("value");

    toggleNoteOnSelection(5);
    let n = useGameStore.getState().notes;
    expect(hasNote(n, target, 5)).toBe(true);
    expect(useGameStore.getState().board[target]).toBe(0);

    // Second call with the same digit toggles the note off again.
    toggleNoteOnSelection(5);
    n = useGameStore.getState().notes;
    expect(hasNote(n, target, 5)).toBe(false);

    // And the history entries are undoable: rolling back once brings
    // the note back; a second undo clears it.
    undo();
    n = useGameStore.getState().notes;
    expect(hasNote(n, target, 5)).toBe(true);
    undo();
    n = useGameStore.getState().notes;
    expect(hasNote(n, target, 5)).toBe(false);
  });

  it("toggleNoteOnSelection is a no-op on cells with a value", () => {
    // If the selected cell already has a digit placed, long-pressing a
    // pad button must NOT silently write notes to a filled cell. The
    // board state and the notes mask for that cell stay untouched.
    const target = 2;
    const { selectCell, inputDigit, toggleNoteOnSelection } =
      useGameStore.getState();

    selectCell(target);
    inputDigit(5); // place a value
    const before = useGameStore.getState().notes[target];

    toggleNoteOnSelection(3);
    const after = useGameStore.getState().notes[target];
    expect(after).toBe(before);
    expect(useGameStore.getState().board[target]).toBe(5);
  });

  it("redo re-prunes peers after an undo", () => {
    const target = 2;
    const samplePeers = emptyPeersOf(target).slice(0, 3);

    const { selectCell, toggleMode, inputDigit, undo, redo } =
      useGameStore.getState();

    toggleMode();
    for (const p of samplePeers) {
      selectCell(p);
      inputDigit(5);
    }
    toggleMode();

    selectCell(target);
    inputDigit(5);
    undo();
    redo();

    const n = useGameStore.getState().notes;
    for (const p of samplePeers) expect(hasNote(n, p, 5)).toBe(false);
    expect(useGameStore.getState().board[target]).toBe(5);
  });
});

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

  it("RAZ-14: progressive hint steps through three tiers and only increments hintsUsed once", async () => {
    // Seed with a solution so the local solver path can run (no need
    // for a remote fetcher). startGame wipes meta.solution so we
    // replace the whole meta here via a second startGame call.
    const SOLUTION =
      "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
    useGameStore.getState().startGame({
      meta: {
        puzzleId: 1,
        difficultyBucket: 0,
        mode: "random",
        solution: SOLUTION,
      },
      puzzle: PUZZLE,
    });

    const { hint, setFeatureFlag } = useGameStore.getState();
    setFeatureFlag("progressiveHints", true);

    // Tier 1: a fresh click spawns a session, bumps hintsUsed, and
    // does NOT mutate the board.
    const boardBefore = Array.from(useGameStore.getState().board);
    await hint();
    let s = useGameStore.getState();
    expect(s.hintsUsed).toBe(1);
    expect(s.hintSession).not.toBeNull();
    expect(s.hintSession?.tier).toBe(1);
    expect(Array.from(s.board)).toEqual(boardBefore);

    // Tier 2: bumps the session to tier 2, leaves everything else alone.
    await hint();
    s = useGameStore.getState();
    expect(s.hintsUsed).toBe(1); // unchanged — still one hint session
    expect(s.hintSession?.tier).toBe(2);
    expect(Array.from(s.board)).toEqual(boardBefore);

    // Tier 3: applies the placement and clears the session.
    const suggestion = s.hintSession!.suggestion;
    await hint();
    s = useGameStore.getState();
    expect(s.hintsUsed).toBe(1); // STILL one — reveal doesn't double-count
    expect(s.hintSession).toBeNull();
    expect(s.board[suggestion.index]).toBe(suggestion.digit);
    expect(s.selection).toBe(suggestion.index);
  });

  it("RAZ-14: selecting a different cell clears an in-flight hint session", async () => {
    const SOLUTION =
      "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
    useGameStore.getState().startGame({
      meta: {
        puzzleId: 1,
        difficultyBucket: 0,
        mode: "random",
        solution: SOLUTION,
      },
      puzzle: PUZZLE,
    });

    const { hint, selectCell, setFeatureFlag } = useGameStore.getState();
    setFeatureFlag("progressiveHints", true);

    await hint();
    expect(useGameStore.getState().hintSession).not.toBeNull();

    selectCell(0); // any selection change
    expect(useGameStore.getState().hintSession).toBeNull();
  });

  it("RAZ-14: with the flag OFF, hint() places immediately in one click (legacy behavior)", async () => {
    const SOLUTION =
      "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
    useGameStore.getState().startGame({
      meta: {
        puzzleId: 1,
        difficultyBucket: 0,
        mode: "random",
        solution: SOLUTION,
      },
      puzzle: PUZZLE,
    });

    const { hint, setFeatureFlag } = useGameStore.getState();
    setFeatureFlag("progressiveHints", false);

    await hint();
    const s = useGameStore.getState();
    expect(s.hintsUsed).toBe(1);
    // No session is ever populated when the flag is off.
    expect(s.hintSession).toBeNull();
    // The board was mutated on the first (and only) click.
    let placed = 0;
    for (let i = 0; i < 81; i++) if (s.board[i] !== 0) placed++;
    // Puzzle clue count + 1 for the placed hint.
    let clues = 0;
    for (let i = 0; i < 81; i++) if (PUZZLE[i] !== "0") clues++;
    expect(placed).toBe(clues + 1);
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

// RAZ-28 — verify that the mutation reducers feed the input-event ring
// buffer, the buffer gates on BOTH the flag AND the per-user opt-in,
// and drainEvents behaves as a non-overlapping FIFO flush.
describe("game-store: RAZ-28 input-event recording", () => {
  beforeEach(start);

  it("does not record when the flag is off, even if the user opted in", () => {
    const { selectCell, inputDigit, setSetting, setFeatureFlag } =
      useGameStore.getState();

    setFeatureFlag("eventLog", false);
    setSetting("recordEvents", true);

    selectCell(2);
    inputDigit(5);
    expect(useGameStore.getState().events.length).toBe(0);
  });

  it("does not record when the user has not opted in, even if the flag is on", () => {
    const { selectCell, inputDigit, setSetting, setFeatureFlag } =
      useGameStore.getState();

    setFeatureFlag("eventLog", true);
    // Explicitly reset — settings are persisted across the test file
    // because Zustand's store is a module-level singleton. A previous
    // test may have opted us in.
    setSetting("recordEvents", false);

    selectCell(2);
    inputDigit(5);
    expect(useGameStore.getState().events.length).toBe(0);
  });

  it("records value, erase, and hint events when flag + opt-in are both on", async () => {
    const SOLUTION =
      "534678912672195348198342567859761423426853791713924856961537284287419635345286179";
    useGameStore.getState().startGame({
      meta: {
        puzzleId: 1,
        difficultyBucket: 0,
        mode: "random",
        solution: SOLUTION,
      },
      puzzle: PUZZLE,
    });
    const {
      selectCell,
      inputDigit,
      eraseSelection,
      hint,
      setSetting,
      setFeatureFlag,
    } = useGameStore.getState();

    setFeatureFlag("eventLog", true);
    // Turn progressiveHints OFF so `hint()` applies the placement in
    // one call — keeps the test focused on event logging rather than
    // the tier state machine.
    setFeatureFlag("progressiveHints", false);
    setSetting("recordEvents", true);

    // Value placement → "v"
    selectCell(2);
    inputDigit(5);
    // Erase → "e" with digit 0
    eraseSelection();
    // Hint placement → "h" with the suggested digit
    await hint();

    const s = useGameStore.getState();
    expect(s.events.length).toBe(3);
    expect(s.events[0].k).toBe("v");
    expect(s.events[0].c).toBe(2);
    expect(s.events[0].d).toBe(5);
    expect(s.events[1].k).toBe("e");
    expect(s.events[1].d).toBe(0);
    expect(s.events[2].k).toBe("h");
    // Timestamps are monotonically non-decreasing.
    expect(s.events[1].t).toBeGreaterThanOrEqual(s.events[0].t);
  });

  it("drainEvents returns the buffer and resets it; seq increments", () => {
    const { selectCell, inputDigit, setSetting, setFeatureFlag, drainEvents } =
      useGameStore.getState();

    setFeatureFlag("eventLog", true);
    setSetting("recordEvents", true);

    selectCell(2);
    inputDigit(5);
    selectCell(3);
    inputDigit(7);

    const first = drainEvents();
    expect(first.events.length).toBe(2);
    expect(first.seq).toBe(0);

    // Buffer is now empty; seq has advanced.
    let s = useGameStore.getState();
    expect(s.events.length).toBe(0);
    expect(s.eventSeq).toBe(1);

    // A subsequent drain on an empty buffer returns empty + the new seq,
    // confirming seq numbers remain monotonic even across no-op drains.
    const second = drainEvents();
    expect(second.events.length).toBe(0);
    expect(second.seq).toBe(1);
    s = useGameStore.getState();
    expect(s.eventSeq).toBe(2);
  });

  it("startGame resets the event buffer and sequence", () => {
    const { selectCell, inputDigit, setSetting, setFeatureFlag } =
      useGameStore.getState();

    setFeatureFlag("eventLog", true);
    setSetting("recordEvents", true);

    selectCell(2);
    inputDigit(5);
    expect(useGameStore.getState().events.length).toBe(1);

    useGameStore.getState().startGame({
      meta: {
        puzzleId: 2,
        difficultyBucket: 0,
        mode: "random",
        solution: null,
      },
      puzzle: PUZZLE,
    });

    const s = useGameStore.getState();
    expect(s.events.length).toBe(0);
    expect(s.eventSeq).toBe(0);
  });
});

describe("game-store: RAZ-42 auto-notes toggle", () => {
  beforeEach(() => {
    start();
    useGameStore.getState().setSetting("autoNotesEnabled", true);
  });

  it("autoFillNotes no-ops when autoNotesEnabled is false", () => {
    useGameStore.getState().setSetting("autoNotesEnabled", false);
    const before = new Uint16Array(useGameStore.getState().notes);
    useGameStore.getState().autoFillNotes();
    const after = useGameStore.getState().notes;
    for (let i = 0; i < 81; i++) expect(after[i]).toBe(before[i]);
  });

  it("autoFillNotes fills candidates when autoNotesEnabled is true", () => {
    useGameStore.getState().autoFillNotes();
    let total = 0;
    const n = useGameStore.getState().notes;
    for (let i = 0; i < 81; i++) total += n[i];
    expect(total).toBeGreaterThan(0);
  });

  // RAZ-43: toggle — second tap clears bulk notes when they match full
  // candidates; third tap fills again.
  it("autoFillNotes clears on second tap when notes match computed candidates", () => {
    useGameStore.getState().autoFillNotes();
    useGameStore.getState().autoFillNotes();
    const b = useGameStore.getState().board;
    const n = useGameStore.getState().notes;
    let sumOnEmpty = 0;
    for (let i = 0; i < 81; i++) {
      if (b[i] === 0) sumOnEmpty += n[i];
    }
    expect(sumOnEmpty).toBe(0);
  });

  it("autoFillNotes fills again after clear", () => {
    useGameStore.getState().autoFillNotes();
    useGameStore.getState().autoFillNotes();
    useGameStore.getState().autoFillNotes();
    let total = 0;
    const n = useGameStore.getState().notes;
    for (let i = 0; i < 81; i++) total += n[i];
    expect(total).toBeGreaterThan(0);
  });
});

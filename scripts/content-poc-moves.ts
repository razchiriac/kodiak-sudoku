export type PlannedMove = {
  cellIndex: number;
  row: number;
  col: number;
  digit: number;
};

export type NoteAction = {
  cellIndex: number;
  row: number;
  col: number;
  digits: number[];
};

export type HumanPlan = {
  fillMoves: PlannedMove[];
  noteActions: NoteAction[];
  correctionCellIndexes: Set<number>;
};

export type PuzzleSnapshot = {
  board: number[];
  solution: string | null;
  mode: "daily" | "random";
};

export type PacePreset = {
  tapDelayMs: number;
  jitterMs: number;
  thinkingPauseEveryNMoves: number;
  thinkingPauseMs: number;
};

export const PACE_PRESETS: readonly PacePreset[] = [
  {
    tapDelayMs: 260,
    jitterMs: 120,
    thinkingPauseEveryNMoves: 7,
    thinkingPauseMs: 900,
  },
  {
    tapDelayMs: 330,
    jitterMs: 140,
    thinkingPauseEveryNMoves: 6,
    thinkingPauseMs: 1_150,
  },
  {
    tapDelayMs: 420,
    jitterMs: 170,
    thinkingPauseEveryNMoves: 5,
    thinkingPauseMs: 1_450,
  },
];

type Rng = () => number;

export function buildMoves(snapshot: PuzzleSnapshot): PlannedMove[] {
  if (snapshot.mode === "daily")
    throw new Error("daily mode is not supported in this POC");

  if (!snapshot.solution)
    throw new Error("meta.solution is missing; expected non-daily /play/<id> route");

  if (snapshot.board.length !== 81)
    throw new Error(`expected 81 cells but received ${snapshot.board.length}`);

  if (snapshot.solution.length !== 81)
    throw new Error(`expected solution length 81 but received ${snapshot.solution.length}`);

  const moves: PlannedMove[] = [];
  for (let cellIndex = 0; cellIndex < snapshot.board.length; cellIndex++) {
    if (snapshot.board[cellIndex] !== 0) continue;
    const digit = Number(snapshot.solution[cellIndex]);
    if (Number.isNaN(digit) || digit < 1 || digit > 9) {
      throw new Error(`invalid solution digit "${snapshot.solution[cellIndex]}" at ${cellIndex}`);
    }
    const row = Math.floor(cellIndex / 9) + 1;
    const col = (cellIndex % 9) + 1;
    moves.push({ cellIndex, row, col, digit });
  }
  return moves;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildHumanPlan(snapshot: PuzzleSnapshot, rng: Rng): HumanPlan {
  const orderedMoves = buildMoves(snapshot);
  const byCell = new Map<number, PlannedMove>();
  for (const move of orderedMoves) byCell.set(move.cellIndex, move);

  const remaining = new Set<number>(orderedMoves.map((move) => move.cellIndex));
  const fillOrder: PlannedMove[] = [];
  let lastCellIndex: number | null = null;

  while (remaining.size > 0) {
    const remainingIndexes: number[] = Array.from(remaining);
    const anchor: number =
      lastCellIndex ?? remainingIndexes[Math.floor(rng() * remainingIndexes.length)];
    const row: number = Math.floor(anchor / 9);
    const col: number = anchor % 9;
    const boxRow: number = Math.floor(row / 3);
    const boxCol: number = Math.floor(col / 3);

    const sameBox: number[] = remainingIndexes.filter((idx) => {
      const r = Math.floor(idx / 9);
      const c = idx % 9;
      return Math.floor(r / 3) === boxRow && Math.floor(c / 3) === boxCol;
    });
    const sameLine: number[] = remainingIndexes.filter((idx) => {
      const r = Math.floor(idx / 9);
      const c = idx % 9;
      return r === row || c === col;
    });

    const bag: number[] =
      sameBox.length > 0 && rng() < 0.5
        ? sameBox
        : sameLine.length > 0 && rng() < 0.8
          ? sameLine
          : remainingIndexes;
    const chosen: number = bag[Math.floor(rng() * bag.length)];
    const move = byCell.get(chosen);
    if (!move) throw new Error(`missing move for cell ${chosen}`);
    fillOrder.push(move);
    remaining.delete(chosen);
    lastCellIndex = chosen;
  }

  const noteCandidates = fillOrder.slice();
  shuffleInPlace(noteCandidates, rng);
  const noteCount = Math.max(8, Math.min(22, Math.floor(fillOrder.length * (0.25 + rng() * 0.12))));
  const noteActions: NoteAction[] = noteCandidates.slice(0, noteCount).map((move) => {
    const extras = pickDistinctWrongDigits(move.digit, rng, 1 + Math.floor(rng() * 2));
    const digits = [move.digit, ...extras];
    shuffleInPlace(digits, rng);
    return {
      cellIndex: move.cellIndex,
      row: move.row,
      col: move.col,
      digits,
    };
  });

  const correctionPool = fillOrder.slice(Math.floor(fillOrder.length * 0.3));
  shuffleInPlace(correctionPool, rng);
  const correctionCount = Math.min(2, Math.max(1, Math.floor(fillOrder.length / 30)));
  const correctionCellIndexes = new Set<number>(
    correctionPool.slice(0, correctionCount).map((move) => move.cellIndex),
  );

  return { fillMoves: fillOrder, noteActions, correctionCellIndexes };
}

function pickDistinctWrongDigits(correctDigit: number, rng: Rng, count: number): number[] {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((digit) => digit !== correctDigit);
  shuffleInPlace(digits, rng);
  return digits.slice(0, count);
}

function shuffleInPlace<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export function jitterMs(baseMs: number, spread: number): number {
  const delta = Math.floor((Math.random() * 2 - 1) * spread);
  return Math.max(20, baseMs + delta);
}

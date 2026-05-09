import { computeCandidates, nextHint } from "@/lib/sudoku/solver";
import type { Board, Variant } from "@/lib/sudoku/board";

type Rng = () => number;

export type AgentDecision = {
  cellIndex: number;
  digit: number;
  technique: string;
  candidateDigits: number[];
  guessed: boolean;
};

export function decideAgentMove(
  boardValues: number[],
  variantValue: string | null | undefined,
  rng: Rng,
): AgentDecision | null {
  const variant = normalizeVariant(variantValue);
  const board = Uint8Array.from(boardValues) as Board;
  const hint = nextHint(board, { variant, solution: null });
  const candidates = computeCandidates(board, variant);

  if (hint) {
    return {
      cellIndex: hint.index,
      digit: hint.digit,
      technique: hint.technique,
      candidateDigits: digitsFromMask(candidates[hint.index]),
      guessed: false,
    };
  }

  const guess = pickGuess(board, candidates, rng);
  if (!guess) return null;
  return {
    cellIndex: guess.cellIndex,
    digit: guess.digit,
    technique: "guess",
    candidateDigits: guess.candidateDigits,
    guessed: true,
  };
}

type GuessChoice = {
  cellIndex: number;
  digit: number;
  candidateDigits: number[];
};

function pickGuess(board: Board, candidates: Uint16Array, rng: Rng): GuessChoice | null {
  const options: Array<{ cellIndex: number; digits: number[] }> = [];
  let minCount = 10;

  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) continue;
    const digits = digitsFromMask(candidates[i]);
    if (digits.length < 2) continue;
    minCount = Math.min(minCount, digits.length);
    options.push({ cellIndex: i, digits });
  }

  const smallest = options.filter((entry) => entry.digits.length === minCount);
  if (smallest.length === 0) return null;
  const pick = smallest[Math.floor(rng() * smallest.length)];
  return {
    cellIndex: pick.cellIndex,
    digit: pick.digits[Math.floor(rng() * pick.digits.length)],
    candidateDigits: pick.digits,
  };
}

export function shouldAddNotes(decision: AgentDecision, rng: Rng): boolean {
  if (decision.candidateDigits.length < 2) return false;
  if (decision.guessed) return rng() < 0.8;
  return rng() < 0.35;
}

export function pickCorrectionDigit(decision: AgentDecision, rng: Rng): number | null {
  const alternatives = decision.candidateDigits.filter((digit) => digit !== decision.digit);
  if (alternatives.length === 0) return null;
  return alternatives[Math.floor(rng() * alternatives.length)];
}

function digitsFromMask(mask: number): number[] {
  const digits: number[] = [];
  for (let digit = 1; digit <= 9; digit++) {
    if ((mask & (1 << (digit - 1))) !== 0) digits.push(digit);
  }
  return digits;
}

function normalizeVariant(variantValue: string | null | undefined): Variant | undefined {
  if (variantValue === "diagonal") return "diagonal";
  return undefined;
}

import { DIFFICULTY_LABEL, formatTime } from "@/lib/utils";

// RAZ-11 / share-result — pure, unit-testable helpers that build the
// Wordle-style text + URL a player shares after finishing a puzzle.
// Kept free of React / DOM / window so tests run in node and the same
// code can be imported from both the completion modal (client) and
// future server code (e.g. an OG-image route that wants to render the
// same tagline).

// Minimum data we need about a finished solve. Matches the fields
// the CompletionModal already reads out of the Zustand store.
export type ShareInput = {
  mode: "daily" | "random";
  difficultyBucket: number;
  // Milliseconds spent on the puzzle.
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  // Daily date (YYYY-MM-DD). Required when mode==="daily", ignored
  // otherwise. The daily page URL uses /daily (today) or
  // /daily/<date> (archive) so we also need this for the link.
  dailyDate?: string;
  // Numeric puzzle id. Required for random mode so the link resolves
  // back to the same puzzle.
  puzzleId?: number;
  // Today in UTC (YYYY-MM-DD). Callers pass it in so the formatter
  // stays deterministic under test. When `dailyDate === today` we
  // link to `/daily`, otherwise to the archive path `/daily/<date>`.
  today?: string;
};

// Build the human-readable share text. Deliberately short so it fits
// in an SMS / tweet preview without the URL getting cut off.
//
// Examples:
//   Sudoku Daily · Hard · 2026-04-19
//   ⏱ 03:12 · 🎯 0 mistakes · 💡 0 hints
//
//   Sudoku · Medium
//   ⏱ 05:41 · 🎯 2 mistakes · 💡 0 hints
export function buildShareText(input: ShareInput): string {
  const label = DIFFICULTY_LABEL[input.difficultyBucket] ?? "Sudoku";
  const headline =
    input.mode === "daily" && input.dailyDate
      ? `Sudoku Daily · ${label} · ${input.dailyDate}`
      : `Sudoku · ${label}`;

  // We keep the stats block small - just the three numbers the modal
  // also surfaces. No star rating / no emoji grid: Sudoku doesn't
  // have a natural per-cell "hit / miss" mapping the way Wordle does,
  // and a made-up grid would read as noise.
  const stats = [
    `⏱ ${formatTime(input.elapsedMs)}`,
    `🎯 ${input.mistakes} mistake${input.mistakes === 1 ? "" : "s"}`,
    `💡 ${input.hintsUsed} hint${input.hintsUsed === 1 ? "" : "s"}`,
  ].join(" · ");

  return `${headline}\n${stats}`;
}

// Build the URL to include in the shared text. We append the stats as
// query params (`t=<ms>&m=<mistakes>&h=<hints>&d=<bucket>&mode=...`)
// so the puzzle / daily pages can hand those values to their
// `generateMetadata` hook and point the OG image at /og/completion
// with the right numbers. Recipients who click through get the live
// puzzle page; crawlers that just fetch the HTML get a rich preview.
export function buildShareUrl(
  input: ShareInput,
  opts: { baseUrl: string },
): string {
  const base = opts.baseUrl.replace(/\/$/, "");
  const q = new URLSearchParams({
    shared: "1",
    t: String(input.elapsedMs),
    m: String(input.mistakes),
    h: String(input.hintsUsed),
    d: String(input.difficultyBucket),
    mode: input.mode,
  });
  if (input.mode === "daily") {
    if (!input.dailyDate) {
      throw new Error("buildShareUrl: dailyDate required when mode='daily'");
    }
    q.set("date", input.dailyDate);
    // When sharing today's daily, link to the canonical /daily URL so
    // the player's friends can resume their own saved progress if any.
    // For archives, link to /daily/<date> (practice mode).
    const path =
      input.today && input.today === input.dailyDate
        ? "/daily"
        : `/daily/${input.dailyDate}`;
    return `${base}${path}?${q.toString()}`;
  }
  if (typeof input.puzzleId !== "number") {
    throw new Error("buildShareUrl: puzzleId required when mode='random'");
  }
  return `${base}/play/${input.puzzleId}?${q.toString()}`;
}

// Convenience: the exact string the Share button copies to the
// clipboard. Two newlines between text and URL so the URL gets
// auto-linkified on Discord / iMessage without the preceding line
// wrapping into it.
export function buildShareBlock(
  input: ShareInput,
  opts: { baseUrl: string },
): string {
  return `${buildShareText(input)}\n\n${buildShareUrl(input, opts)}`;
}

import { NextRequest, NextResponse } from "next/server";
import { renderToBuffer } from "@react-pdf/renderer";
import { getPuzzleById } from "@/lib/db/queries";
import { decodeNotes } from "@/lib/sudoku/notes-codec";
import {
  PuzzleDoc,
  isValidPuzzleString,
  type PencilMarks,
} from "@/lib/pdf/puzzle-doc";
import { printPuzzle } from "@/lib/flags";
import { DIFFICULTY_LABEL } from "@/lib/utils";

// RAZ-9 — GET /print/<puzzleId>?board=<original|81-chars>&marks=<none|template|b64>
//
// Streams back a server-rendered PDF of the puzzle. The route is
// stateless: the puzzle id is a DB lookup but the board and notes
// (if the player picked "My progress" / "My current notes") arrive
// as query params. This lets the print flow work anonymously (no
// auth needed) and keeps the route pure — no saved_games read.
//
// Why a route handler rather than a Server Action
//   The browser needs a URL it can navigate to or a <a download>
//   link that triggers the save dialog. Server actions return
//   serialized JS values, not streamed responses; piping a PDF
//   through one would require a two-round-trip flow.
//
// Query param shapes
//   board = "original"   → render the puzzle column as-is
//   board = "<81 chars>"  → render the player's current board (must
//                          be 81 chars of 0-9 or `.`; invalid →
//                          400 so the UI can toast a clear error)
//
//   marks = "none"       → no pencil marks
//   marks = "template"    → auto-compute candidates from the
//                          current board (see computeAllCandidates)
//   marks = "<b64>"       → player's current notes, encoded by the
//                          existing encodeNotes helper (reused from
//                          the saved_games autosave path)
//
// Output
//   200 application/pdf — Content-Disposition: attachment; filename=
//     "sudoku-<id>.pdf". Buffer (rather than stream) because
//     @react-pdf/renderer's renderToStream is Node-only and the
//     whole doc is tiny (~30 kB) so streaming adds no perceivable
//     win for the user.
//
// Errors
//   403 when the feature flag is off (defensive — nav should not
//       have rendered the button, but a direct URL hit is possible)
//   400 when query params are malformed
//   404 when the puzzle id doesn't resolve
//   500 when React-PDF throws — returned as plain text so fetch
//       callers can log it; this path is exceedingly rare once
//       isValidPuzzleString has run.

export const dynamic = "force-dynamic";
// React-PDF needs Node APIs (Buffer, fs) so this route can't run
// on the Edge runtime. Explicitly pin to Node to prevent an
// accidental build-time conversion if Next.js ever infers Edge.
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ puzzleId: string }> },
) {
  if (!(await printPuzzle())) {
    return new NextResponse("Print is disabled.", { status: 403 });
  }

  const { puzzleId } = await params;
  const id = Number.parseInt(puzzleId, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return new NextResponse("Invalid puzzle id.", { status: 400 });
  }

  const puzzle = await getPuzzleById(id);
  if (!puzzle) return new NextResponse("Puzzle not found.", { status: 404 });

  const url = new URL(req.url);
  const boardParam = url.searchParams.get("board") ?? "original";
  const marksParam = url.searchParams.get("marks") ?? "none";

  // Resolve the "what digits go on the grid" choice. For "original"
  // we render the clue string verbatim; for progress we accept a
  // player-provided 81-char string. Anything else is a malformed
  // param, so we fail fast with a 400.
  let boardDigits: string;
  if (boardParam === "original") {
    boardDigits = puzzle.puzzle;
  } else if (isValidPuzzleString(boardParam)) {
    boardDigits = boardParam;
  } else {
    return new NextResponse(
      `Invalid board param (expected "original" or 81 chars of 0-9/.)`,
      { status: 400 },
    );
  }

  // Resolve the pencil-mark choice. "none" and "template" are the
  // only non-base64 values; everything else is treated as the
  // player's encoded notes buffer (decodeNotes already returns an
  // empty Uint16Array on parse failure, so an invalid payload just
  // degrades to no marks rather than a 400 — better UX here because
  // the player has already committed to the print).
  let marks: PencilMarks;
  if (marksParam === "none") {
    marks = { kind: "none" };
  } else if (marksParam === "template") {
    marks = { kind: "template" };
  } else {
    const notes = decodeNotes(marksParam);
    marks = { kind: "custom", notes };
  }

  // Build the header copy. Kept centralized in the handler so the
  // PDF component stays format-free and we can change branding
  // without editing the layout code.
  const difficultyName = DIFFICULTY_LABEL[puzzle.difficultyBucket] ?? "Puzzle";
  const title = `${difficultyName} Sudoku`;
  const boardLabel =
    boardParam === "original" ? "Original puzzle" : "My progress";
  const marksLabel =
    marks.kind === "none"
      ? "no pencil marks"
      : marks.kind === "template"
        ? "template pencil marks"
        : "my pencil marks";
  const meta = `#${puzzle.id} · ${boardLabel} · ${marksLabel}`;

  try {
    const buffer = await renderToBuffer(
      <PuzzleDoc
        puzzle={boardDigits}
        fixedPuzzle={puzzle.puzzle}
        marks={marks}
        title={title}
        meta={meta}
      />,
    );
    // Content-Disposition makes the browser prompt a Save dialog
    // instead of rendering inline. Filename encodes the puzzle id
    // so users can easily tell print-outs apart; we don't include
    // any player-identifying info because the URL is unauthenticated.
    // Copy the PDF bytes into a fresh ArrayBuffer. NextResponse's
    // BodyInit union accepts ArrayBuffer but not Node's Buffer (nor
    // ArrayBufferLike-backed typed arrays) in the current Next.js
    // types. The copy is unavoidable with the current types; the
    // PDFs are tens of KB so the extra allocation is negligible.
    const ab = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(ab).set(buffer);
    return new NextResponse(ab, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="sudoku-${puzzle.id}.pdf"`,
        // Short cache — same (puzzle, board, marks) triple is stable,
        // so allow a brief CDN cache hit, but don't go wild because
        // the "progress" and "notes" variants are user-specific and
        // a long TTL could leak a player's in-progress board to a
        // public cache. 60s is a reasonable middle ground that
        // survives double-clicks and retries.
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (err) {
    // If we made it past isValidPuzzleString and @react-pdf/renderer
    // still blew up, something about the doc component is off.
    // Surface the error (text, not JSON) so fetch callers can log it
    // verbatim during dev.
    console.error("[print] PDF render failed", err);
    return new NextResponse("Failed to render PDF.", { status: 500 });
  }
}

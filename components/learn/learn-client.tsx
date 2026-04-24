"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cell } from "@/components/game/cell";
import { peers } from "@/lib/sudoku/board";
import {
  evaluateLessonAttempt,
  lessonFixedMask,
  lessonPuzzleToBoard,
} from "@/lib/learn/journey";
import { useLearnStore } from "@/lib/learn/progress";
import type { Lesson } from "@/lib/learn/lessons";

// RAZ-47 — Lesson player. A self-contained Sudoku micro-board that:
//   1. Loads the lesson's puzzle into a Uint8Array on mount.
//   2. Lets the player click a cell + type a digit (or use the on-
//      screen pad) to fill it.
//   3. Validates every move against the lesson's solution via
//      `evaluateLessonAttempt`. Wrong placements tint the cell red
//      via the existing Cell `isMistake` prop.
//   4. On `passed`, persists the lesson id to the local progress
//      store and shows a "Lesson complete" panel with a CTA to the
//      next lesson (or back to the journey index).
//
// Why we DON'T reuse SudokuGrid:
//   - SudokuGrid is hard-wired to the global game store. We don't
//     want lessons polluting the active-game state, the timer, the
//     undo stack, or the haptics layer (lessons should feel calm).
//   - The lesson loop is much simpler: no notes, no pause, no
//     hint button (the lesson IS the hint). A 90-line dedicated
//     player is clearer than threading "lesson mode" through the
//     game store.
//   - We DO reuse the `Cell` primitive directly so colors, ARIA
//     labels, and conflict styling stay perfectly in sync with the
//     main board.

type LearnClientProps = {
  lesson: Lesson;
  // Optional: id of the next lesson (if any), so the completion
  // panel can render a "Continue" CTA. Server component computes
  // this from the static catalog and passes it down.
  nextLessonId: string | null;
};

export function LearnClient({ lesson, nextLessonId }: LearnClientProps) {
  // Two parallel arrays mirror the main game store's shape so the
  // Cell component's prop contract works without translation:
  //   - `board[i]` is the player's current digit (0 = empty).
  //   - `fixed[i]` is 1 for clue cells (read-only), 0 otherwise.
  // We seed both from the lesson definition once on mount.
  const [board, setBoard] = useState<Uint8Array>(() =>
    lessonPuzzleToBoard(lesson.puzzle),
  );
  // The clue mask is invariant for the lifetime of the lesson, so
  // we compute it lazily once via useMemo against the lesson id.
  // Recomputing per-render is cheap (81 cells) but useMemo signals
  // intent: "this is constant data".
  const fixed = useMemo(() => lessonFixedMask(lesson.puzzle), [lesson.puzzle]);
  const [selection, setSelection] = useState<number | null>(null);

  // The player progress store. We grab the `markCompleted` action
  // once via a stable selector so re-renders of this component
  // don't churn the subscription.
  const markCompleted = useLearnStore((s) => s.markCompleted);

  // Evaluator runs every render — it's a single linear scan over the
  // 81 cells so it's effectively free. Returning the status object
  // here means the JSX layer doesn't have to remember to re-check
  // after every state update.
  const status = useMemo(
    () => evaluateLessonAttempt(lesson, board),
    [lesson, board],
  );

  // Persist completion exactly once when the player solves the
  // lesson. The effect's dependency on `status.kind` means a transient
  // "passed → mistake → passed" sequence (caused by, say, the player
  // tapping a wrong digit then correcting it) only fires markCompleted
  // on the FIRST passed transition; the store itself is idempotent
  // anyway, so the worst case is a duplicate timestamp write.
  useEffect(() => {
    if (status.kind === "passed") {
      markCompleted(lesson.id);
    }
  }, [status.kind, lesson.id, markCompleted]);

  // Derived: peer set + same-digit set for the currently selected
  // cell. Same shape as SudokuGrid uses, so the Cell component's
  // visual highlights (peer dim, same-digit accent) Just Work.
  const peerSet = useMemo(() => {
    if (selection == null) return new Set<number>();
    return new Set<number>(peers(selection));
  }, [selection]);
  const selectedDigit = selection != null ? board[selection] : 0;

  // The set of indices the evaluator currently flags as wrong.
  // We treat ANY non-zero cell whose value disagrees with the
  // solution as a mistake — strictly more aggressive than the main
  // game store (which gates this behind a setting), because in a
  // lesson the player is HERE to learn; surfacing wrong digits is
  // the whole point.
  const mistakeSet = useMemo(() => {
    const set = new Set<number>();
    for (let i = 0; i < 81; i++) {
      if (board[i] !== 0 && fixed[i] === 0) {
        const expected = lesson.solution.charCodeAt(i) - 48;
        if (board[i] !== expected) set.add(i);
      }
    }
    return set;
  }, [board, fixed, lesson.solution]);

  // Place a digit (1..9) into the currently selected cell. Refuses
  // to mutate clue cells. Setting the same digit twice acts as an
  // erase (matches the main game's number-pad behaviour).
  const placeDigit = useCallback(
    (digit: number) => {
      if (selection == null) return;
      if (fixed[selection] === 1) return;
      setBoard((prev) => {
        const next = new Uint8Array(prev);
        next[selection] = next[selection] === digit ? 0 : digit;
        return next;
      });
    },
    [selection, fixed],
  );

  // Erase the selected cell. Distinct action so the on-screen pad's
  // erase button has clear semantics even if the player hasn't yet
  // typed a digit there.
  const eraseSelected = useCallback(() => {
    if (selection == null) return;
    if (fixed[selection] === 1) return;
    setBoard((prev) => {
      if (prev[selection] === 0) return prev;
      const next = new Uint8Array(prev);
      next[selection] = 0;
      return next;
    });
  }, [selection, fixed]);

  // Reset the lesson to its starting state. The player can re-attempt
  // any time without leaving the page — useful for "I want to start
  // over from scratch" without losing the URL.
  const resetLesson = useCallback(() => {
    setBoard(lessonPuzzleToBoard(lesson.puzzle));
    setSelection(null);
  }, [lesson.puzzle]);

  // Keyboard: digits 1-9 place, 0/Backspace/Delete erase, arrow keys
  // move selection. Mirrors the main board's controls so muscle memory
  // transfers. Bound to window so the player doesn't have to focus
  // the grid first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Skip when the player is typing into an input (e.g. devtools
      // search) so we don't hijack 1-9 keystrokes there.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
        return;
      }
      if (e.key >= "1" && e.key <= "9") {
        placeDigit(Number(e.key));
        e.preventDefault();
        return;
      }
      if (e.key === "0" || e.key === "Backspace" || e.key === "Delete") {
        eraseSelected();
        e.preventDefault();
        return;
      }
      if (selection != null) {
        const r = Math.floor(selection / 9);
        const c = selection % 9;
        if (e.key === "ArrowUp" && r > 0) setSelection(selection - 9);
        else if (e.key === "ArrowDown" && r < 8) setSelection(selection + 9);
        else if (e.key === "ArrowLeft" && c > 0) setSelection(selection - 1);
        else if (e.key === "ArrowRight" && c < 8) setSelection(selection + 1);
        else return;
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placeDigit, eraseSelected, selection]);

  return (
    <div className="container max-w-2xl py-8">
      <header className="mb-6">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {techniqueLabel(lesson.technique)}
        </div>
        <h1 className="mt-1 text-2xl font-bold">{lesson.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{lesson.tagline}</p>
      </header>

      <article className="mb-6 rounded-lg border bg-card p-4 text-sm leading-relaxed">
        {/* Render the markdown intro as paragraphs. We split on blank
            lines because the catalog hand-authors with `\n\n` paragraph
            breaks and we don't want to pull in a markdown parser for
            this v0. Bold-asterisk pairs ARE rendered (regex below)
            because the intros lean on **emphasis** for technique
            terms; everything else passes through as plain text. */}
        {lesson.intro.split(/\n\n+/).map((para, i) => (
          <p key={i} className={i === 0 ? "" : "mt-3"}>
            {renderEmphasis(para)}
          </p>
        ))}
      </article>

      {/* Status banner: surface mistakes inline, between the prose and
          the board, so the player isn't left guessing why a cell turned
          red. Hidden when the lesson is in-progress with no mistakes. */}
      {status.kind === "mistake" && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>That's not the right digit.</strong>{" "}
            Look at row {Math.floor(status.firstWrongIndex / 9) + 1}, column{" "}
            {(status.firstWrongIndex % 9) + 1} — what other values are
            already present in its row, column, and box?
          </span>
        </div>
      )}

      {/* Board. The grid wraps to fit its container; max width keeps
          it readable on huge desktops. */}
      <div className="mx-auto aspect-square w-full max-w-md select-none">
        <div
          role="grid"
          aria-label={`${lesson.title} board`}
          className="grid h-full w-full grid-cols-9 grid-rows-9 overflow-hidden rounded-md border-2 border-foreground/60"
        >
          {Array.from({ length: 81 }, (_, i) => (
            <Cell
              key={i}
              index={i}
              value={board[i]}
              notesMask={0}
              isFixed={fixed[i] === 1}
              isSelected={selection === i}
              isPeer={peerSet.has(i) && selection !== i}
              isSameDigit={
                selectedDigit > 0 && board[i] === selectedDigit && selection !== i
              }
              isConflict={false}
              isMistake={mistakeSet.has(i)}
              highlightNoteDigit={0}
              onSelect={setSelection}
            />
          ))}
        </div>
      </div>

      {/* On-screen number pad — small + simple. We don't bother with
          the main board's long-press notes pad here because lessons
          don't use notes mode. */}
      <div className="mt-6 grid grid-cols-9 gap-1">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <Button
            key={d}
            variant="outline"
            className="h-12 text-lg font-semibold"
            onClick={() => placeDigit(d)}
            aria-label={`Place ${d} in the selected cell`}
          >
            {d}
          </Button>
        ))}
      </div>

      {/* Action row: erase, restart, exit. The completion panel
          replaces this row when the player passes. */}
      {status.kind !== "passed" ? (
        <div className="mt-3 flex justify-between gap-2">
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={eraseSelected}>
              Erase
            </Button>
            <Button variant="ghost" size="sm" onClick={resetLesson}>
              <RefreshCw className="mr-1 h-3 w-3" />
              Restart
            </Button>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/learn">Back to lessons</Link>
          </Button>
        </div>
      ) : (
        <CompletionPanel
          lessonTitle={lesson.title}
          nextLessonId={nextLessonId}
          onRestart={resetLesson}
        />
      )}
    </div>
  );
}

// Tiny inline emphasis renderer: turns `**bold**` into <strong> and
// leaves everything else alone. Avoids a markdown dep for the half-
// dozen bold spans the lesson intros use.
function renderEmphasis(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  // Greedy split on **...** pairs. Anything outside the pairs renders
  // as plain text; anything inside renders as a <strong>.
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(<strong key={`b${key++}`}>{match[1]}</strong>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function techniqueLabel(t: Lesson["technique"]): string {
  if (t === "naked-single") return "Naked Single";
  if (t === "hidden-single") return "Hidden Single";
  if (t === "pointing-pair") return "Pointing Pair";
  if (t === "box-line-reduction") return "Box-Line Reduction";
  if (t === "naked-pair") return "Naked Pair";
  if (t === "naked-triple") return "Naked Triple";
  if (t === "hidden-pair") return "Hidden Pair";
  if (t === "x-wing") return "X-Wing";
  if (t === "swordfish") return "Swordfish";
  return "Mixed Techniques";
}

function CompletionPanel({
  lessonTitle,
  nextLessonId,
  onRestart,
}: {
  lessonTitle: string;
  nextLessonId: string | null;
  onRestart: () => void;
}) {
  return (
    <div className="mt-6 rounded-lg border-2 border-primary/40 bg-primary/5 p-5">
      <div className="flex items-center gap-2 text-primary">
        <CheckCircle2 className="h-5 w-5" />
        <h2 className="text-base font-semibold">Lesson complete</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Nice. You solved <strong>{lessonTitle}</strong> using the technique
        the lesson teaches. Your progress is saved on this device.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {nextLessonId ? (
          <Button asChild>
            <Link href={`/learn/${nextLessonId}`}>Next lesson</Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href="/learn">Back to lessons</Link>
          </Button>
        )}
        <Button variant="outline" onClick={onRestart}>
          <RefreshCw className="mr-1 h-3 w-3" />
          Try again
        </Button>
      </div>
    </div>
  );
}

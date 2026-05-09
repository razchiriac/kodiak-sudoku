"use client";

import { memo, useMemo } from "react";
import type { Arrow } from "@/lib/sudoku/arrow";
import { isArrowSatisfied } from "@/lib/sudoku/arrow";
import type { Board } from "@/lib/sudoku/board";

/**
 * RAZ-120: SVG overlay that renders Arrow Sudoku constraints on top of the
 * 9×9 grid. Uses `viewBox="0 0 9 9"` so each cell occupies a 1×1 unit,
 * matching the pattern established by DiagonalOverlay in sudoku-grid.tsx.
 *
 * Color coding:
 *   - Gray (neutral): arrow is incomplete (some cells still empty)
 *   - Green: all cells filled and sum constraint is satisfied
 *   - Red: all cells filled but sum constraint is violated
 *
 * Positioned as `absolute inset-0` with `pointer-events-none` so clicks
 * pass through to the underlying Cell components.
 */

interface ArrowOverlayProps {
  arrows: readonly Arrow[];
  board: Board;
}

/** Radius of the circle drawn around the arrow's "sum" cell. */
const CIRCLE_RADIUS = 0.38;

/** Stroke width for circles and arrow lines. */
const STROKE_WIDTH = 0.06;

/** Size of the arrowhead (equilateral triangle side length). */
const ARROW_HEAD_SIZE = 0.18;

/**
 * Determines the visual state of a single arrow.
 *   - "neutral": at least one cell in the arrow is empty
 *   - "satisfied": all filled, sum matches
 *   - "violated": all filled, sum doesn't match
 */
type ArrowState = "neutral" | "satisfied" | "violated";

function getArrowState(arrow: Arrow, board: Board): ArrowState {
  const circleDigit = board[arrow.circle];
  if (circleDigit === 0) return "neutral";

  let sum = 0;
  for (const idx of arrow.cells) {
    const d = board[idx];
    if (d === 0) return "neutral";
    sum += d;
  }

  return sum === circleDigit ? "satisfied" : "violated";
}

/** Maps arrow state to a Tailwind-compatible stroke color class. */
const STATE_COLORS: Record<ArrowState, string> = {
  neutral: "stroke-muted-foreground/50",
  satisfied: "stroke-green-600 dark:stroke-green-400",
  violated: "stroke-red-600 dark:stroke-red-400",
};

/**
 * Converts a flat cell index (0–80) to the center point in our 9×9 viewBox.
 * Cell (row=0, col=0) has its center at (0.5, 0.5).
 */
function cellCenter(index: number): { x: number; y: number } {
  const row = Math.floor(index / 9);
  const col = index % 9;
  return { x: col + 0.5, y: row + 0.5 };
}

/**
 * Computes a point along the line from `from` toward `to`, inset by
 * `distance` units from `from`. Used to start the line at the circle
 * edge rather than at the cell center.
 */
function insetFrom(
  from: { x: number; y: number },
  to: { x: number; y: number },
  distance: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return from;
  return { x: from.x + (dx / len) * distance, y: from.y + (dy / len) * distance };
}

/**
 * Computes the arrowhead triangle points at the tip of the arrow path.
 * The head is an equilateral triangle pointing from `from` → `to`.
 */
function arrowheadPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return "";

  // Unit vector along arrow direction
  const ux = dx / len;
  const uy = dy / len;

  // Perpendicular unit vector
  const px = -uy;
  const py = ux;

  // Triangle vertices: tip at `to`, base offset behind `to`
  const tipX = to.x;
  const tipY = to.y;
  const baseLeftX = to.x - ux * size + px * (size / 2);
  const baseLeftY = to.y - uy * size + py * (size / 2);
  const baseRightX = to.x - ux * size - px * (size / 2);
  const baseRightY = to.y - uy * size - py * (size / 2);

  return `${tipX},${tipY} ${baseLeftX},${baseLeftY} ${baseRightX},${baseRightY}`;
}

/** Renders a single arrow (circle + path + arrowhead). */
function ArrowPath({ arrow, state }: { arrow: Arrow; state: ArrowState }) {
  const colorClass = STATE_COLORS[state];
  const center = cellCenter(arrow.circle);

  // Build the polyline path from the circle edge through all body cells.
  // Start the line at the edge of the circle (inset from center toward
  // the first body cell) so it doesn't overlap the circle stroke.
  const bodyCenters = arrow.cells.map(cellCenter);

  if (bodyCenters.length === 0) return null;

  // Line starts at the circle perimeter (toward first body cell)
  const lineStart = insetFrom(center, bodyCenters[0], CIRCLE_RADIUS);

  // Build polyline points: start + all body cell centers
  const pathPoints = [lineStart, ...bodyCenters];

  // For the arrowhead, we draw at the last body cell center, pointing
  // from the second-to-last point toward the last.
  const lastIdx = pathPoints.length - 1;
  const secondLast = pathPoints[Math.max(0, lastIdx - 1)];
  const last = pathPoints[lastIdx];

  // Shorten the last segment so the arrowhead tip lands at the cell center
  // instead of overlapping beyond it.
  const shortenedLast = insetFrom(last, secondLast, ARROW_HEAD_SIZE * 0.5);
  const adjustedPoints = [...pathPoints.slice(0, lastIdx), shortenedLast];

  const polylineStr = adjustedPoints.map((p) => `${p.x},${p.y}`).join(" ");
  const headPoints = arrowheadPoints(secondLast, last, ARROW_HEAD_SIZE);

  return (
    <g className={colorClass}>
      {/* Circle around the "sum" cell */}
      <circle
        cx={center.x}
        cy={center.y}
        r={CIRCLE_RADIUS}
        fill="none"
        strokeWidth={STROKE_WIDTH}
      />
      {/* Polyline from circle edge through body cells */}
      <polyline
        points={polylineStr}
        fill="none"
        strokeWidth={STROKE_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Arrowhead at the tip */}
      {headPoints && (
        <polygon
          points={headPoints}
          strokeWidth={0}
          className={colorClass.replace("stroke-", "fill-")}
        />
      )}
    </g>
  );
}

/** Memoized arrow overlay placed over the grid. */
export const ArrowOverlay = memo(function ArrowOverlay({ arrows, board }: ArrowOverlayProps) {
  // Compute arrow states in one pass so we don't recalculate per-element.
  const arrowStates = useMemo(
    () => arrows.map((a) => getArrowState(a, board)),
    [arrows, board],
  );

  if (arrows.length === 0) return null;

  return (
    <svg
      viewBox="0 0 9 9"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {arrows.map((arrow, i) => (
        <ArrowPath key={i} arrow={arrow} state={arrowStates[i]} />
      ))}
    </svg>
  );
});

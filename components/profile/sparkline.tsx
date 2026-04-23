// RAZ-30 — Sparkline for a player's recent solve times on a given
// difficulty bucket. Pure inline SVG, zero dependencies, server-
// renderable (no `"use client"`). Design goals:
//
//   1. Read at a glance: shape matters more than absolute numbers.
//      A downward slope = "getting faster" = dopamine. We deliberately
//      invert the Y axis so shorter times draw LOWER on the chart,
//      matching the player's intuition ("I'm improving when the line
//      goes down").
//   2. No dependencies: keeps the profile page cheap to render and
//      trivially theme-adaptive via `currentColor`.
//   3. Accessible: a polite SR-friendly label summarises the trend
//      (first → last + best), and the chart is marked role="img".
//
// When given fewer than 2 points, we return null — a single dot is
// not a trend. The caller is expected to decide what to render in
// the zero / one-solve case.
import { formatTime } from "@/lib/utils";

export function Sparkline({
  points,
  width = 120,
  height = 32,
  ariaLabel,
}: {
  points: number[];
  width?: number;
  height?: number;
  ariaLabel?: string;
}) {
  if (points.length < 2) return null;

  // Padding inside the SVG viewBox so points near the edges don't
  // get clipped by the stroke. 2px matches our default 1.5px stroke
  // plus a half-pixel breathing room.
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const min = Math.min(...points);
  const max = Math.max(...points);
  // Guard against a flat series (all equal). `range` would be 0 and
  // we'd divide by zero mapping to the Y axis. We treat this as a
  // centered flat line instead.
  const range = max - min;

  // Map each point to SVG coords. X is evenly spaced along the width;
  // Y is inverted because faster (smaller) times should draw lower,
  // which in SVG means a LARGER y value (origin is top-left). That
  // flip gives us "line goes down == improving" visually.
  const coords = points.map((p, i) => {
    const x = pad + (i * innerW) / (points.length - 1);
    const y =
      range === 0
        ? pad + innerH / 2
        : pad + innerH - ((p - min) / range) * innerH;
    return { x, y };
  });

  const d = coords
    .map((c, i) => (i === 0 ? `M${c.x},${c.y}` : `L${c.x},${c.y}`))
    .join(" ");

  const first = points[0];
  const last = points[points.length - 1];
  const best = Math.min(...points);
  // Default aria summary: mention improvement / regression + best.
  // Chart isn't a screen-reader's favourite element anyway, so we
  // lean on a text summary rather than individual <title>s per point.
  const delta = last - first;
  const trend =
    delta < 0 ? "improving" : delta > 0 ? "slower" : "flat";
  const defaultLabel = `Trend ${trend} over last ${points.length} solves. Best ${formatTime(best)}, first ${formatTime(first)}, last ${formatTime(last)}.`;

  return (
    <svg
      role="img"
      aria-label={ariaLabel ?? defaultLabel}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className="text-primary"
      preserveAspectRatio="none"
    >
      {/* Polyline path. `currentColor` inherits the Tailwind text
          color so it auto-themes; stroke-linecap/linejoin smooth
          out the corners on a 1.5px stroke. */}
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Last-point dot as a subtle "you are here" marker. The
          earlier points are intentionally left unmarked to keep
          the sparkline quiet. */}
      <circle
        cx={coords[coords.length - 1].x}
        cy={coords[coords.length - 1].y}
        r={2}
        fill="currentColor"
      />
    </svg>
  );
}

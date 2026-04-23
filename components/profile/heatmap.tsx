"use client";

// RAZ-31 — 7x24 solve-count heatmap for the profile page.
//
// Why a client component:
//   The profile page is a server component, but the heatmap has
//   to bucket timestamps in the *viewer's* local timezone to make
//   "you solve fastest at 7am Thursday" meaningful. Server-side
//   we only have UTC (or whatever tz the Supabase Postgres host
//   is on), which would misalign hours for every non-UTC user.
//
// Why inline SVG / plain divs:
//   The grid is 168 small cells. Each cell is a CSS-styled div —
//   cheaper than SVG rects for a responsive layout, and the color
//   palette maps cleanly to Tailwind's primary-alpha ladder.
//
// Rendering strategy:
//   - Build the 7x24 grid once via `bucketSolves`.
//   - Compute stats (peak cell + max) once via `summarize`.
//   - Render rows Sun..Sat top-to-bottom (matching the week as
//     most calendars show it) and hours left-to-right.
//
// Accessibility:
//   The outer figure has a role/aria-label that summarises the
//   dataset ("7x24 solve heatmap, 123 solves, most active Thu
//   7am"). Each cell carries an aria-label with its own count
//   so a screen-reader user can tab through.

import { useMemo } from "react";
import {
  bucketSolves,
  formatHour,
  intensity,
  summarize,
  WEEKDAY_FULL,
  WEEKDAY_LABELS,
} from "@/lib/profile/heatmap";

export function SolveHeatmap({ timestamps }: { timestamps: Date[] }) {
  // The profile page passes serialised Date objects (Next.js
  // marshals these via the RSC wire format). `useMemo` is a
  // defensive optimisation: if the parent re-renders for any
  // other reason, we don't rebucket 3000 timestamps.
  const { grid, stats } = useMemo(() => {
    const g = bucketSolves(timestamps);
    return { grid: g, stats: summarize(g) };
  }, [timestamps]);

  if (stats.total === 0) {
    // Empty-state: keep the section visible so the profile page
    // layout stays stable, but swap the grid for a friendly
    // one-liner. Without this, the section would pop in once
    // the first solve lands, which feels jumpy.
    return (
      <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No solves yet. Finish a puzzle to see your rhythm.
      </div>
    );
  }

  const peakLabel = stats.peak
    ? `${WEEKDAY_FULL[stats.peak.weekday]} at ${formatHour(stats.peak.hour)}`
    : null;

  // Only show every third hour label on the x-axis (12a, 3a, 6a,
  // ... 9p). Full-density labels make the row illegible on mobile
  // viewports because each cell is <20px wide.
  const hourTicks = [0, 3, 6, 9, 12, 15, 18, 21];

  return (
    <figure
      role="img"
      aria-label={`Solve heatmap: ${stats.total} solves${
        peakLabel ? `, most active ${peakLabel}` : ""
      }`}
      className="rounded-lg border bg-card p-4"
    >
      {peakLabel ? (
        <figcaption className="mb-3 text-sm text-muted-foreground">
          You solve most often on{" "}
          <span className="font-medium text-foreground">{peakLabel}</span>.
        </figcaption>
      ) : null}

      {/* Grid container: column for weekday labels, then the 24
          data columns. We use CSS grid (rather than a table) so
          cells stay perfectly square at any viewport width. */}
      <div className="overflow-x-auto">
        <div className="inline-block min-w-full">
          {/* Hour tick row */}
          <div
            className="grid text-[10px] text-muted-foreground"
            style={{
              gridTemplateColumns: "2rem repeat(24, minmax(0.75rem, 1fr))",
            }}
            aria-hidden="true"
          >
            <div />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center">
                {hourTicks.includes(h) ? formatHour(h) : ""}
              </div>
            ))}
          </div>

          {/* Seven data rows */}
          {grid.map((row, d) => (
            <div
              key={d}
              className="grid items-center"
              style={{
                gridTemplateColumns: "2rem repeat(24, minmax(0.75rem, 1fr))",
              }}
            >
              <div className="pr-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground">
                {WEEKDAY_LABELS[d]}
              </div>
              {row.map((count, h) => {
                const t = intensity(count, stats.max);
                // Tailwind doesn't interpolate opacity for
                // arbitrary bg colors well, so we use inline style
                // for the tint. The base color is the theme's
                // `primary` expressed through a CSS variable the
                // theme system already sets. A count of zero uses
                // a muted cell so the grid shape stays visible.
                const bg =
                  t === 0
                    ? "hsl(var(--muted))"
                    : `hsl(var(--primary) / ${0.2 + t * 0.8})`;
                return (
                  <div
                    key={h}
                    role="gridcell"
                    aria-label={`${WEEKDAY_FULL[d]} ${formatHour(h)}: ${count} ${
                      count === 1 ? "solve" : "solves"
                    }`}
                    title={`${WEEKDAY_LABELS[d]} ${formatHour(h)} — ${count}`}
                    className="m-[1px] aspect-square rounded-[2px]"
                    style={{ background: bg }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </figure>
  );
}

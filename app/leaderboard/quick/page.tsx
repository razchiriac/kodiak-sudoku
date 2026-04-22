import { notFound } from "next/navigation";
import Link from "next/link";
import { getQuickLeaderboardWeekly } from "@/lib/db/queries";
import { quickPlay } from "@/lib/flags";
import { formatTime } from "@/lib/utils";

// Refresh once a minute so a fresh solve shows up without hammering the DB.
export const dynamic = "force-dynamic";
export const revalidate = 60;

// RAZ-34: Quick-play weekly leaderboard.
//
// Unlike the daily board (ranked by single-puzzle time), quick-play is
// a volume game: whoever solves the most Easy random puzzles this week
// wins. Ties are broken by the most recent solve, which has the nice
// property that a tied player who's still active today outranks one
// who finished their run on Monday morning.
//
// We scope to the current ISO week (Monday 00:00 UTC through now) via
// `date_trunc('week', now())` in the query. Everyone sees the same
// window regardless of their local timezone; keeping the cutoff in UTC
// avoids a whole class of off-by-one bugs at week boundaries.
//
// Flag-gated: when `quick-play` is off we 404 the route so stale
// bookmarks degrade loudly rather than showing an empty board.

export default async function QuickLeaderboardPage() {
  const enabled = await quickPlay();
  if (!enabled) notFound();

  const rows = await getQuickLeaderboardWeekly({ limit: 50 });

  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Quick-play · weekly</h1>
        <p className="text-sm text-muted-foreground">
          Most Easy puzzles solved this week. Ties broken by most recent
          solve.
        </p>
      </header>

      {/* Quick deep-link so a player landing here from the nav can
          jump straight into another round without hunting for the
          CTA. Positioned above the board so it's visible even when
          the list is long. */}
      <p className="mb-4 text-sm">
        <Link
          className="text-primary underline-offset-4 hover:underline"
          href="/play/quick"
        >
          Play a quick puzzle →
        </Link>
      </p>

      <Board rows={rows} />
    </div>
  );
}

type Row = Awaited<ReturnType<typeof getQuickLeaderboardWeekly>>[number];

// Board is a thin presentational list. We show three columns: rank,
// name, and count-of-solves. Best-time is captured in the query for
// completeness (future tooltip / expanded row), but v1 keeps the UI
// scannable and count-first because that's what the leaderboard is
// ranked on.
function Board({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        No quick solves yet this week. Be the first.
      </p>
    );
  }
  return (
    <ol className="divide-y rounded-lg border bg-card">
      {rows.map((r, i) => (
        <li
          key={`${r.userId}-${r.lastCompletedAt.toString()}`}
          className="flex items-center gap-3 p-3"
        >
          <span className="w-6 text-right font-mono text-sm tabular-nums text-muted-foreground">
            {i + 1}
          </span>
          <span className="flex-1 truncate text-sm">
            {r.displayName ?? r.username ?? "Anonymous"}
          </span>
          {/* Best time for the week — secondary info, muted so it
              doesn't compete with the primary rank metric (count). */}
          <span
            className="w-20 text-right font-mono text-xs tabular-nums text-muted-foreground"
            aria-label={`Best time ${formatTime(r.bestTimeMs)}`}
          >
            {formatTime(r.bestTimeMs)}
          </span>
          <span className="w-16 text-right font-mono text-sm tabular-nums">
            {r.count} {r.count === 1 ? "solve" : "solves"}
          </span>
        </li>
      ))}
    </ol>
  );
}

import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

// RAZ-5 / daily-archive: small header strip above the daily play UI
// that lets the user walk prev/next through available daily puzzles.
// Pure server-rendered (no client state) so it can be dropped into any
// server component. Renders nothing when both adjacent dates are null
// — avoids a useless empty row when there are no other dailies.
//
// `current` is purely informational (shown in the middle). `prev` /
// `next` may be null, in which case that side renders as a disabled
// placeholder so the center stays centered.
export function ArchiveNav({
  current,
  prev,
  next,
  leaderboardHref,
}: {
  current: string;
  prev: string | null;
  next: string | null;
  // Optional deep link to this date's leaderboard. Daily play pages
  // pass `/leaderboard?date=YYYY-MM-DD` so finishing the archive
  // puzzle is one click from seeing the scores for that day.
  leaderboardHref?: Route;
}) {
  if (!prev && !next && !leaderboardHref) return null;

  return (
    <div className="mx-auto mt-3 flex w-full max-w-[560px] items-center justify-between gap-2 px-2 text-xs text-muted-foreground">
      {prev ? (
        <Link
          href={`/daily/${prev}`}
          className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-accent hover:text-accent-foreground"
          aria-label={`Previous daily: ${prev}`}
        >
          <ChevronLeft className="size-3.5" />
          {prev}
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-1 opacity-40">
          <ChevronLeft className="size-3.5" />
          —
        </span>
      )}

      <span className="flex-1 truncate text-center font-mono tabular-nums">
        {current}
      </span>

      {next ? (
        <Link
          href={`/daily/${next}`}
          className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-accent hover:text-accent-foreground"
          aria-label={`Next daily: ${next}`}
        >
          {next}
          <ChevronRight className="size-3.5" />
        </Link>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-1 opacity-40">
          —
          <ChevronRight className="size-3.5" />
        </span>
      )}

      {leaderboardHref ? (
        <Link
          href={leaderboardHref}
          className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-accent hover:text-accent-foreground"
          aria-label={`Leaderboard for ${current}`}
        >
          <CalendarDays className="size-3.5" />
        </Link>
      ) : null}
    </div>
  );
}

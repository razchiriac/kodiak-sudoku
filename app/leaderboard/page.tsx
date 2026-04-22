import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  getAdjacentDailyDates,
  getDailyLeaderboard,
  getDailyPuzzle,
} from "@/lib/db/queries";
import { dailyArchive, difficultyLeaderboards } from "@/lib/flags";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime, DIFFICULTY_LABEL } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 60;

// Daily leaderboard. Shows two tabs: "Pure" (no hints) is the default and
// is what we promote in marketing; "All" includes anyone who finished,
// regardless of hints. We sort by time, ties broken by completion time.
//
// RAZ-5 / daily-archive: accepts a `?date=YYYY-MM-DD` search param so
// players can look at past leaderboards. Defaults to today. Prev/next
// navigation uses `getAdjacentDailyDates` to skip over gaps in the
// daily_puzzles table (rare but possible). When the archive flag is
// off, any `?date=` other than today is ignored — the page always
// renders today's board.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function LeaderboardPage({
  searchParams,
}: {
  // Next 15: searchParams is a Promise in RSC.
  searchParams: Promise<{ date?: string }>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const sp = await searchParams;
  const archiveEnabled = await dailyArchive();

  // Figure out which date this page is scoped to. Fall back to today on
  // any bad or future input so the page never 500s on a typo'd URL.
  let date = today;
  if (archiveEnabled && sp.date && DATE_RE.test(sp.date) && sp.date <= today) {
    date = sp.date;
  }

  const daily = await getDailyPuzzle(date);

  const [pure, all] = daily
    ? await Promise.all([
        getDailyLeaderboard(date, { pure: true, limit: 50 }),
        getDailyLeaderboard(date, { pure: false, limit: 50 }),
      ])
    : [[], []];

  const adjacent = archiveEnabled
    ? await getAdjacentDailyDates(date)
    : { prev: null, next: null };

  // RAZ-6: expose the per-difficulty boards from the daily page as a
  // small nav strip. Fetched in parallel with the leaderboard rows via
  // Promise.all above would be nicer; kept simple here because the
  // flag resolve is cached.
  const diffLeaderboardsEnabled = await difficultyLeaderboards();

  const isToday = date === today;

  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {isToday ? "Daily leaderboard" : "Daily leaderboard · archive"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {daily
              ? `${date} · ${DIFFICULTY_LABEL[daily.puzzle.difficultyBucket]}`
              : `No daily puzzle scheduled on ${date}.`}
          </p>
        </div>

        {/* Prev/next archive nav. Only rendered when the flag is on and
            at least one direction has a target, so today's default page
            stays uncluttered when there's no yesterday row yet. */}
        {archiveEnabled && (adjacent.prev || adjacent.next) ? (
          <nav
            className="flex items-center gap-1 text-sm"
            aria-label="Leaderboard date navigation"
          >
            {adjacent.prev ? (
              <Link
                href={`/leaderboard?date=${adjacent.prev}`}
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-accent hover:text-accent-foreground"
                aria-label={`Previous leaderboard: ${adjacent.prev}`}
              >
                <ChevronLeft className="size-4" />
                {adjacent.prev}
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground opacity-40">
                <ChevronLeft className="size-4" />
                —
              </span>
            )}
            {adjacent.next ? (
              <Link
                href={
                  adjacent.next === today
                    ? "/leaderboard"
                    : `/leaderboard?date=${adjacent.next}`
                }
                className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-accent hover:text-accent-foreground"
                aria-label={`Next leaderboard: ${adjacent.next}`}
              >
                {adjacent.next}
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-1 text-muted-foreground opacity-40">
                —
                <ChevronRight className="size-4" />
              </span>
            )}
          </nav>
        ) : null}
      </header>

      {/* Handy deep-link: from an archive leaderboard the user probably
          wants to play that date's puzzle. Hidden on today because the
          header already points them at /daily. */}
      {archiveEnabled && !isToday && daily ? (
        <p className="mb-4 text-sm">
          <Link
            className="text-primary underline-offset-4 hover:underline"
            href={`/daily/${date}`}
          >
            Play this puzzle →
          </Link>
        </p>
      ) : null}

      {/* RAZ-6: cross-links to the per-difficulty leaderboards. Placed
          above the daily board because expert grinders who come here
          looking for an all-time board shouldn't have to scroll past
          today's rankings to find them. Flag off = strip hidden and
          the daily page looks exactly as it did pre-RAZ-6. */}
      {diffLeaderboardsEnabled ? (
        <section
          className="mb-6 rounded-lg border bg-card p-4"
          aria-label="All-time leaderboards"
        >
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
            All-time leaderboards
          </h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {[1, 2, 3, 4].map((b) => (
              <Link
                key={b}
                href={`/leaderboard/difficulty/${b}`}
                className="rounded-md border px-3 py-1 hover:bg-accent hover:text-accent-foreground"
              >
                {DIFFICULTY_LABEL[b]}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <Tabs defaultValue="pure">
        <TabsList>
          <TabsTrigger value="pure">Pure</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
        <TabsContent value="pure">
          <Board rows={pure} pure />
        </TabsContent>
        <TabsContent value="all">
          <Board rows={all} pure={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof getDailyLeaderboard>>[number];

function Board({ rows, pure }: { rows: Row[]; pure: boolean }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        {pure
          ? "No hint-free completions yet. Be the first."
          : "No completions yet. Be the first."}
      </p>
    );
  }
  return (
    <ol className="divide-y rounded-lg border bg-card">
      {rows.map((r, i) => (
        <li key={`${r.userId}-${r.completedAt.toString()}`} className="flex items-center gap-3 p-3">
          <span className="w-6 text-right font-mono text-sm tabular-nums text-muted-foreground">
            {i + 1}
          </span>
          <span className="flex-1 truncate text-sm">
            {r.displayName ?? r.username ?? "Anonymous"}
          </span>
          <span className="font-mono text-sm tabular-nums">{formatTime(r.timeMs)}</span>
          {!pure && (
            <span className="w-12 text-right text-xs text-muted-foreground">
              {r.hintsUsed > 0 ? `+${r.hintsUsed}h` : ""}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

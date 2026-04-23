import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { getDifficultyLeaderboard } from "@/lib/db/queries";
import { difficultyLeaderboards } from "@/lib/flags";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { formatTime, DIFFICULTY_LABEL } from "@/lib/utils";

// RAZ-74: `force-dynamic` already renders on every request — the
// `revalidate = 60` that used to live here pinned the board for
// up to a minute, so a player's fresh solve wouldn't show up on
// their own per-difficulty leaderboard. The DB query is small and
// indexed; traffic is low; freshness wins.
export const dynamic = "force-dynamic";

// RAZ-6: Per-difficulty all-time leaderboard.
//
// Ranks best single random-mode time per user within the given
// difficulty bucket. Supports two axes:
//   - `window` ∈ {all, week}: query-string controlled, defaults to
//     all-time. "week" means rolling last 7 days.
//   - pure / all-hints: rendered as two tabs, same convention as the
//     daily board so returning users aren't surprised.
//
// Scope note: daily-mode completions are NOT included. They have
// their own per-date board at /leaderboard. Otherwise the same user
// would show up twice with effectively the same solve (daily rows are
// also inserted into completed_games with their difficulty bucket),
// which makes the "best Expert time this week" board misleading.
//
// Flag: `difficulty-leaderboards`. Off = the route 404s (stale links
// fail loud rather than quietly empty) and the /leaderboard page's
// cross-links disappear.

const BUCKETS = [1, 2, 3, 4] as const;
type Bucket = (typeof BUCKETS)[number];
type Window = "all" | "week";

// Typed route builder. typedRoutes only knows about literal paths, so
// we assemble the dynamic bucket path here and cast once. Keeps every
// caller above a normal `Route` boundary.
function diffHref(bucket: Bucket, window: Window): Route {
  const qs = window === "week" ? "?window=week" : "";
  return `/leaderboard/difficulty/${bucket}${qs}` as Route;
}

export default async function DifficultyLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ bucket: string }>;
  // Next 15: searchParams arrives as a promise in server components.
  searchParams: Promise<{ window?: string }>;
}) {
  const enabled = await difficultyLeaderboards();
  if (!enabled) notFound();

  const { bucket: bucketRaw } = await params;
  const bucketNum = Number(bucketRaw);
  if (!Number.isInteger(bucketNum) || !BUCKETS.includes(bucketNum as Bucket)) {
    notFound();
  }
  const bucket = bucketNum as Bucket;

  const sp = await searchParams;
  const window: Window = sp.window === "week" ? "week" : "all";

  // Parallel fetch pure + all tabs; both use the same window.
  const [pure, all] = await Promise.all([
    getDifficultyLeaderboard(bucket, { window, pure: true, limit: 50 }),
    getDifficultyLeaderboard(bucket, { window, pure: false, limit: 50 }),
  ]);

  const label = DIFFICULTY_LABEL[bucket];

  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">{label} · all-time leaderboard</h1>
        <p className="text-sm text-muted-foreground">
          Fastest single {label.toLowerCase()} random-puzzle solve per
          player. Daily puzzles rank on the{" "}
          <Link
            href="/leaderboard"
            className="text-primary underline-offset-4 hover:underline"
          >
            daily board
          </Link>
          .
        </p>
      </header>

      {/* Difficulty switcher. Keeps the user one click away from
          another bucket without hunting for breadcrumbs. Inactive
          links get the muted-border treatment, the active one gets
          a solid primary chip. */}
      <nav
        className="mb-4 flex flex-wrap items-center gap-2 text-sm"
        aria-label="Difficulty"
      >
        {BUCKETS.map((b) => {
          const active = b === bucket;
          return (
            <Link
              key={b}
              href={diffHref(b, window)}
              aria-current={active ? "page" : undefined}
              className={
                active
                  ? "rounded-md border border-primary bg-primary/10 px-3 py-1 font-medium text-primary"
                  : "rounded-md border bg-card px-3 py-1 text-muted-foreground hover:text-foreground"
              }
            >
              {DIFFICULTY_LABEL[b]}
            </Link>
          );
        })}
      </nav>

      {/* Window toggle: all-time vs last 7 days. Query-string-based so
          the page stays a server component; each click is a normal
          navigation. */}
      <nav
        className="mb-4 flex items-center gap-2 text-sm"
        aria-label="Time window"
      >
        <Link
          href={diffHref(bucket, "all")}
          aria-current={window === "all" ? "page" : undefined}
          className={
            window === "all"
              ? "rounded-md border border-foreground px-3 py-1 font-medium"
              : "rounded-md border bg-card px-3 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          All time
        </Link>
        <Link
          href={diffHref(bucket, "week")}
          aria-current={window === "week" ? "page" : undefined}
          className={
            window === "week"
              ? "rounded-md border border-foreground px-3 py-1 font-medium"
              : "rounded-md border bg-card px-3 py-1 text-muted-foreground hover:text-foreground"
          }
        >
          Last 7 days
        </Link>
      </nav>

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

type Row = Awaited<ReturnType<typeof getDifficultyLeaderboard>>[number];

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
        <li
          key={`${r.userId}-${r.firstAchievedAt.toString()}`}
          className="flex items-center gap-3 p-3"
        >
          <span className="w-6 text-right font-mono text-sm tabular-nums text-muted-foreground">
            {i + 1}
          </span>
          <span className="flex-1 truncate text-sm">
            {r.displayName ?? r.username ?? "Anonymous"}
          </span>
          {/* Secondary: how many solves they have in this window.
              Useful context — someone with one 3:10 might be a lucky
              outlier, someone with 40 solves at 3:10 is the real deal. */}
          <span className="w-16 text-right text-xs text-muted-foreground">
            {r.solveCount} {r.solveCount === 1 ? "solve" : "solves"}
          </span>
          <span className="w-20 text-right font-mono text-sm tabular-nums">
            {formatTime(r.bestTimeMs)}
          </span>
        </li>
      ))}
    </ol>
  );
}

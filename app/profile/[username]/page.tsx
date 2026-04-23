import { notFound } from "next/navigation";
import Link from "next/link";
import { Flame, Snowflake, Trophy } from "lucide-react";
import {
  getProfileByUsername,
  getRecentTimesByBucket,
  getSolveTimestamps,
  listRecentCompletions,
  getUserStats,
} from "@/lib/db/queries";
import { listEarnedAchievements } from "@/lib/server/achievements";
import { DIFFICULTY_LABEL, formatTime } from "@/lib/utils";
import { Sparkline } from "@/components/profile/sparkline";
import { SolveHeatmap } from "@/components/profile/heatmap";
import { AchievementsRow } from "@/components/profile/achievements-row";

export const dynamic = "force-dynamic";
export const revalidate = 30;

// Public profile: stats per difficulty, daily streak, recent completions.
// Anyone can view; the underlying queries do not include private data
// (everything here is either fully public or already RLS-permitted).
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  // RAZ-30: in addition to the aggregated stats and the recent-list,
  // fetch the last 20 solve times per difficulty so each card can
  // render a sparkline. Four parallel queries is fine — each hits the
  // (user_id, completed_at desc) index and returns at most 20 rows.
  const [
    stats,
    recent,
    trendEasy,
    trendMedium,
    trendHard,
    trendExpert,
    heatmapTimestamps,
    earnedAchievements,
  ] = await Promise.all([
    getUserStats(profile.id),
    listRecentCompletions(profile.id, 20),
    getRecentTimesByBucket(profile.id, 1, 20),
    getRecentTimesByBucket(profile.id, 2, 20),
    getRecentTimesByBucket(profile.id, 3, 20),
    getRecentTimesByBucket(profile.id, 4, 20),
    // RAZ-31: up to 3000 recent solve timestamps for the heatmap.
    // Client bucketing (see SolveHeatmap) uses the viewer's
    // local timezone so hour labels feel right.
    getSolveTimestamps(profile.id, 3000),
    // RAZ-10: earned achievement rows. The component itself
    // renders locked badges too, so we don't need the catalog
    // here — just the earned list.
    listEarnedAchievements(profile.id),
  ]);
  // Index trends by bucket so the difficulty map below can look each
  // one up by number without a chain of conditionals.
  const trendsByBucket: Record<number, { timeMs: number }[]> = {
    1: trendEasy,
    2: trendMedium,
    3: trendHard,
    4: trendExpert,
  };

  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-8 flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-2xl">
          {(profile.displayName ?? profile.username ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{profile.displayName ?? profile.username}</h1>
          <p className="text-sm text-muted-foreground">@{profile.username}</p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <Stat
            icon={<Flame className="h-4 w-4" />}
            label="Streak"
            value={profile.currentDailyStreak.toString()}
            sub={`best ${profile.longestDailyStreak}`}
          />
          {/* RAZ-8: Streak freezes — spent automatically by the
              Postgres trigger to forgive missed days. We surface the
              bank so players know they have a safety net (and how
              much). Hidden when zero on a fresh account so the
              header doesn't look cluttered for brand-new users. */}
          {profile.streakFreezesAvailable > 0 ? (
            <Stat
              icon={<Snowflake className="h-4 w-4" />}
              label="Freezes"
              value={profile.streakFreezesAvailable.toString()}
              sub="auto-spent"
            />
          ) : null}
        </div>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((b) => {
          const s = stats.find((x) => x.difficulty === b);
          // RAZ-30: feed the bucket's ordered series into the Sparkline.
          // We only draw when there are ≥2 points (a single solve has
          // no trend to show); the component returns null otherwise.
          const trendPoints = (trendsByBucket[b] ?? []).map((r) => r.timeMs);
          return (
            <div key={b} className="rounded-lg border bg-card p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {DIFFICULTY_LABEL[b]}
              </div>
              <div className="mt-1 font-semibold">{s?.count ?? 0} solved</div>
              <div className="text-xs text-muted-foreground">
                Best: {s?.bestTimeMs ? formatTime(s.bestTimeMs) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Avg: {s?.avgTimeMs ? formatTime(s.avgTimeMs) : "—"}
              </div>
              {trendPoints.length >= 2 ? (
                <div className="mt-2">
                  <Sparkline
                    points={trendPoints}
                    width={160}
                    height={28}
                    ariaLabel={`${DIFFICULTY_LABEL[b]} trend across last ${trendPoints.length} solves`}
                  />
                </div>
              ) : null}
            </div>
          );
        })}
      </section>

      {/* RAZ-10: achievements row — always shown, locked badges
          included, so new users have a visible goal list. */}
      <section className="mb-8">
        <AchievementsRow earned={earnedAchievements} />
      </section>

      {/* RAZ-31: solve heatmap. Only shown when there's at least
          one solve — the SolveHeatmap component itself renders an
          empty-state, but we skip the section heading when there
          is no data to avoid a visually lonely "Activity" label
          on a brand-new profile. */}
      {heatmapTimestamps.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Activity
          </h2>
          <SolveHeatmap timestamps={heatmapTimestamps} />
        </section>
      ) : null}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent completions
        </h2>
        {recent.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No completions yet.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {recent.map(({ completed, puzzle }) => (
              <li
                key={completed.id}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Link
                  href={`/play/${puzzle.id}`}
                  className="flex-1 truncate hover:underline"
                >
                  {DIFFICULTY_LABEL[puzzle.difficultyBucket]}
                  {completed.mode === "daily" && " · Daily"}
                </Link>
                <span className="font-mono tabular-nums">{formatTime(completed.timeMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-mono text-2xl tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

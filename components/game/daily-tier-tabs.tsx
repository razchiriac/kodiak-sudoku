// RAZ-33 — Tier selector for the daily puzzle / leaderboard pages.
//
// Server-renderable (no "use client"). It's just three links with
// styling for "active tier". Next's Link handles prefetching.
//
// The `href` function is passed in so the same component works for
// both /daily and /leaderboard (the query-string and path shape
// differ slightly between them).

import Link from "next/link";
import type { Route } from "next";
import { DIFFICULTY_LABEL } from "@/lib/utils";

export const DAILY_TIERS = [1, 2, 3] as const;
export type DailyTier = (typeof DAILY_TIERS)[number];

/** "easy" | "medium" | "hard" → bucket int, defensive against bad input. */
export function parseTier(raw: string | string[] | undefined): DailyTier {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (v === "medium") return 2;
  if (v === "hard") return 3;
  return 1;
}

/** bucket int → slug. */
export function tierSlug(bucket: DailyTier): string {
  if (bucket === 2) return "medium";
  if (bucket === 3) return "hard";
  return "easy";
}

export function DailyTierTabs({
  active,
  hrefFor,
  availableBuckets,
}: {
  active: DailyTier;
  hrefFor: (tier: DailyTier) => string;
  /** Only render tabs for buckets that exist in the DB for this
   *  date. On rare dates where e.g. Medium wasn't seeded, we
   *  hide the Medium tab instead of rendering a broken link. */
  availableBuckets: number[];
}) {
  return (
    <nav
      aria-label="Daily difficulty tier"
      className="mb-4 flex flex-wrap gap-2"
    >
      {DAILY_TIERS.filter((t) => availableBuckets.includes(t)).map((tier) => {
        const isActive = tier === active;
        return (
          <Link
            key={tier}
            href={hrefFor(tier) as Route}
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded-md border border-primary bg-primary/10 px-3 py-1 text-sm font-medium text-primary"
                : "rounded-md border px-3 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            }
          >
            {DIFFICULTY_LABEL[tier]}
          </Link>
        );
      })}
    </nav>
  );
}

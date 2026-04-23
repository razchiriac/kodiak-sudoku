// RAZ-10 — Badge row for the profile page.
//
// Renders ALL achievements (earned and locked). Locked badges
// use the same layout but render greyed-out with a subtle border
// so the page doesn't shift size as the user earns more. The
// tooltip / title attribute carries the description so hovering
// an earned badge explains what it represents.
//
// Server-renderable: no interactivity, no state. We deliberately
// resolve Lucide icons by name via a small static map so the
// component stays server-safe and we avoid shipping the entire
// Lucide bundle.

import {
  CalendarCheck,
  CalendarHeart,
  Crown,
  Flame,
  Gem,
  Lock,
  Sparkles,
  Sun,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  ACHIEVEMENT_DEFS,
  type AchievementDef,
} from "@/lib/server/achievements-defs";

// Map of icon-name → Lucide component. Keeping it local to the
// component avoids pulling the definition module into any other
// file's import graph.
const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Flame,
  Trophy,
  Crown,
  Gem,
  Sun,
  CalendarCheck,
  CalendarHeart,
  Zap,
};

export function AchievementsRow({
  earned,
}: {
  earned: Array<AchievementDef & { earnedAt: Date }>;
}) {
  // Build a lookup so the render loop over ALL defs can tell
  // each entry whether the user earned it.
  const earnedByKey = new Map(earned.map((a) => [a.key, a]));
  const earnedCount = earned.length;
  const totalCount = ACHIEVEMENT_DEFS.length;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">Achievements</h3>
        <span className="text-xs text-muted-foreground">
          {earnedCount} / {totalCount}
        </span>
      </div>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
        {ACHIEVEMENT_DEFS.map((def) => {
          const isEarned = earnedByKey.has(def.key);
          const Icon = ICONS[def.icon] ?? Sparkles;
          return (
            <li
              key={def.key}
              // Title attribute gives a hover tooltip on desktop
              // and a long-press preview on mobile — both good
              // fallbacks since we avoid the JS tooltip
              // component to keep this server-rendered.
              title={`${def.title} — ${def.description}${
                isEarned ? "" : " (locked)"
              }`}
              className={
                isEarned
                  ? "flex flex-col items-center gap-1 rounded-lg border bg-background p-3 text-center"
                  : "flex flex-col items-center gap-1 rounded-lg border border-dashed bg-muted/30 p-3 text-center opacity-60"
              }
            >
              <span
                className={
                  isEarned
                    ? "grid h-9 w-9 place-items-center rounded-full bg-primary/10 text-primary"
                    : "grid h-9 w-9 place-items-center rounded-full bg-muted text-muted-foreground"
                }
              >
                {isEarned ? (
                  <Icon className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Lock className="h-4 w-4" aria-hidden="true" />
                )}
              </span>
              <span className="text-xs font-medium leading-tight">
                {def.title}
              </span>
              <span className="text-[10px] text-muted-foreground leading-tight">
                {def.description}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// Single source of truth for every feature flag in the app. Pure data,
// zero runtime imports — specifically, no `server-only` — so both
// `lib/flags.ts` (server flag declarations) AND `scripts/sync-flags.ts`
// (Edge Config sync) can import it.
//
// Adding a new flag:
//   1. Append an entry below.
//   2. Declare the typed `flag()` export in `lib/flags.ts` (one line).
//   3. Run `npm run flags:sync` to upsert into Edge Config.
//
// The sync script NEVER overwrites an existing Edge Config value, so
// bumping a flag's `defaultValue` here after it's been flipped live has
// no effect in prod. That's intentional — the dashboard / Edge Config
// is the runtime source of truth; this registry just bootstraps new
// keys with a safe default.

export type FlagSpec = {
  // Canonical flag key. Must match the Edge Config key and the
  // `key:` field of the flag() declaration in lib/flags.ts.
  key: string;
  // Env var consulted as a fallback when Edge Config has no value
  // (or the SDK fails). Matches FLAG_* naming convention used
  // throughout .env.example / Vercel env vars.
  envKey: string;
  // Initial value the sync script writes into Edge Config when the
  // key is missing. Project policy: default new flags to TRUE so CI
  // previews exercise the real path; if a flag needs a dark rollout
  // flip it after it lands in Edge Config (the sync script never
  // overwrites existing values).
  defaultValue: boolean;
  // Human-readable description, mirrored into Edge Config and shown
  // in the Vercel Flags Overview dashboard.
  description: string;
  // Linear ticket ID the flag is tied to. Makes cleanup trivial —
  // grep the registry for RAZ-NN, delete once the ticket is done
  // and the flag is 100% rolled out.
  linearId: string;
};

export const FLAG_REGISTRY: readonly FlagSpec[] = [
  {
    key: "pb-ribbon",
    envKey: "FLAG_PB_RIBBON",
    defaultValue: false,
    description: "Show personal-best ribbon in completion modal.",
    linearId: "RAZ-22",
  },
  {
    key: "haptics",
    envKey: "FLAG_HAPTICS",
    defaultValue: false,
    description: "Vibrate on value placements (mobile only).",
    linearId: "RAZ-19",
  },
  {
    key: "solve-time-sanity",
    envKey: "FLAG_SOLVE_TIME_SANITY",
    defaultValue: true,
    description:
      "Reject leaderboard submissions whose client timer exceeds wall-clock since saved_games.started_at by >10%.",
    linearId: "RAZ-27",
  },
  {
    key: "auto-switch-digit",
    envKey: "FLAG_AUTO_SWITCH_DIGIT",
    defaultValue: true,
    description:
      "Highlight the last-placed digit on the number pad and auto-advance to the next incomplete digit when one is fully placed.",
    linearId: "RAZ-16",
  },
  {
    key: "auto-pause",
    envKey: "FLAG_AUTO_PAUSE",
    defaultValue: true,
    description:
      "Pause the game when the tab is hidden or after 90s of input idle; toast on resume.",
    linearId: "RAZ-21",
  },
  {
    key: "daily-archive",
    envKey: "FLAG_DAILY_ARCHIVE",
    defaultValue: true,
    description:
      "Expose past daily puzzles via /daily/[date] and per-date leaderboards with prev/next nav. Archive completions are practice-only (not scored).",
    linearId: "RAZ-5",
  },
  {
    key: "share-result",
    envKey: "FLAG_SHARE_RESULT",
    defaultValue: true,
    description:
      "Render a Share button in the completion modal (navigator.share + clipboard fallback) and emit dynamic OG images for completion links.",
    linearId: "RAZ-11",
  },
  {
    key: "compact-controls",
    envKey: "FLAG_COMPACT_CONTROLS",
    defaultValue: true,
    description:
      "Expose a settings toggle that forces a compact (h-14) 3x3 number pad on mobile so the board has more breathing room on ultra-tall phones.",
    linearId: "RAZ-23",
  },
];

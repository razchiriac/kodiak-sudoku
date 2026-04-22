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
  {
    // RAZ-17: after a value placement, jump selection to the next
    // empty peer (same row / col / box) so the player can keep
    // placing the same digit without manually moving the caret. The
    // flag controls whether the setting row is rendered at all; the
    // actual behavior is opt-in via the per-user setting. Default the
    // flag ON so CI previews exercise the branch; default the user
    // setting OFF so existing players see no surprise jumps.
    key: "jump-on-place",
    envKey: "FLAG_JUMP_ON_PLACE",
    defaultValue: true,
    description:
      "Expose a settings toggle that jumps the selection to the next empty row/col/box peer after placing a value.",
    linearId: "RAZ-17",
  },
  {
    // RAZ-20: long-press a number-pad button to toggle that digit as a
    // note on the selected cell without leaving value mode. Matches the
    // convention used by most mobile sudoku apps. Additive on desktop
    // too (a click-and-hold also triggers it) but the primary win is
    // mobile, where a notes-mode round-trip is otherwise required.
    key: "long-press-note",
    envKey: "FLAG_LONG_PRESS_NOTE",
    defaultValue: true,
    description:
      "Holding a number-pad button for 400ms toggles that digit as a note on the selected empty cell, regardless of current mode.",
    linearId: "RAZ-20",
  },
  {
    // RAZ-26: OpenDyslexic font option. The flag controls whether the
    // settings toggle is even rendered; the per-user setting controls
    // whether the font is applied on a given device. Self-hosted via
    // @fontsource/opendyslexic so there is no external CDN dependency.
    key: "dyslexia-font",
    envKey: "FLAG_DYSLEXIA_FONT",
    defaultValue: true,
    description:
      "Expose a settings toggle that swaps the UI font to OpenDyslexic for readers who prefer it.",
    linearId: "RAZ-26",
  },
  {
    // RAZ-34: Quick-play sub-2-min Easy mode. When on, /play/quick
    // picks a random Easy puzzle and the completion modal offers a
    // one-click "Next puzzle" CTA so players can chain solves. The
    // weekly leaderboard at /leaderboard/quick ranks by completion
    // count per ISO week (not single best time). Flag gates both the
    // /play/quick entry and the /leaderboard/quick page so we can
    // roll the mode back if the engagement hypothesis doesn't pan out.
    key: "quick-play",
    envKey: "FLAG_QUICK_PLAY",
    defaultValue: true,
    description:
      "Expose /play/quick (auto-new-puzzle Easy mode) and /leaderboard/quick (weekly solve-count leaderboard).",
    linearId: "RAZ-34",
  },
  {
    // RAZ-25: Colorblind-safe palette. Exposes a settings dropdown
    // with three options — default, Okabe-Ito (red/green-safe), and
    // high-contrast. The selected palette maps to the `data-palette`
    // attribute on <html>; CSS variable overrides in globals.css
    // swap the sudoku cell token set. The flag controls whether the
    // picker is rendered at all; when off, the default palette is
    // used regardless of any previously-persisted user preference.
    key: "color-palette",
    envKey: "FLAG_COLOR_PALETTE",
    defaultValue: true,
    description:
      "Expose a settings picker that swaps the sudoku cell palette between default, Okabe-Ito (colorblind-safe), and high-contrast variants.",
    linearId: "RAZ-25",
  },
  {
    // RAZ-6: Per-difficulty all-time leaderboards. Exposes a new family
    // of routes at /leaderboard/difficulty/[bucket] ranked by best
    // single time per user within that difficulty bucket, scoped to
    // `mode='random'` (daily solves have their own boards). Each board
    // supports a 7-day window in addition to all-time, and the same
    // pure/all hints split the daily board uses. Flag gates both the
    // tab on /leaderboard and the difficulty routes, so a soft rollback
    // hides the feature entirely.
    key: "difficulty-leaderboards",
    envKey: "FLAG_DIFFICULTY_LEADERBOARDS",
    defaultValue: true,
    description:
      "Expose per-difficulty leaderboards (/leaderboard/difficulty/[bucket]) with all-time and last-7-days windows, pure/all tabs.",
    linearId: "RAZ-6",
  },
  {
    // RAZ-15: Per-cell mistake indicator. When the user opts in and the
    // client has the puzzle solution (random non-daily puzzles only),
    // any cell whose placed value doesn't match the solution tints red
    // immediately — a superset of conflict highlighting. Default off in
    // the per-user setting so purists keep the "find your own errors"
    // experience; the flag just governs whether the toggle row is
    // rendered in the settings dialog. Daily puzzles never surface
    // mistake tinting client-side because the solution is server-only.
    key: "show-mistakes",
    envKey: "FLAG_SHOW_MISTAKES",
    defaultValue: true,
    description:
      "Expose a settings toggle that tints wrong placements red in real time (random puzzles only — daily solutions stay server-side).",
    linearId: "RAZ-15",
  },
];

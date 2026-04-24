import "server-only";
import { flag } from "flags/next";
import { get } from "@vercel/edge-config";
import { FLAG_REGISTRY, type FlagSpec } from "./flag-registry";

// Typed flag declarations for the app. The registry in
// `lib/flag-registry.ts` is the source of truth for keys, env var
// names, default values, and descriptions — this file just wires each
// registry entry to a `flag()` call that resolves against Edge Config
// first, env var second, defaultValue last.
//
// Usage from a Server Component or Server Action:
//
//     import { pbRibbon } from "@/lib/flags";
//     const show = await pbRibbon();
//
// Client Components CANNOT import this module (`server-only` guard).
// Evaluate server-side and forward the resolved boolean as a prop.
// When adding a new flag:
//   1. Add a row to FLAG_REGISTRY.
//   2. Add a named export here via `declareFlag("<key>")`.
//   3. Run `npm run flags:sync` to create the key in Edge Config.

// Resolve a boolean flag with Edge-Config-first, env-var-fallback
// semantics. Extracted so every flag declaration stays a one-liner.
async function resolveBool(edgeKey: string, envKey: string): Promise<boolean> {
  // Only call Edge Config if a connection string is wired up; otherwise
  // the SDK throws on every invocation which is noisy in local dev.
  if (process.env.EDGE_CONFIG) {
    try {
      const val = await get<boolean>(edgeKey);
      if (typeof val === "boolean") return val;
      // Missing key / wrong type: fall through to env var fallback.
    } catch {
      // Edge Config unreachable (network blip, bad connection string).
      // Fall through rather than crashing the page render.
    }
  }
  return process.env[envKey] === "true";
}

// Build a typed flag from a registry row. Each export below calls
// `declareFlag("<key>")` so the compile-time "flag must exist in
// registry" check lives here rather than being repeated.
function declareFlag(key: FlagSpec["key"]) {
  const spec = FLAG_REGISTRY.find((f) => f.key === key);
  if (!spec) {
    // Registry/export mismatch is a developer mistake; crash loudly
    // at import time so it's obvious in CI.
    throw new Error(`Flag "${key}" is not registered in FLAG_REGISTRY`);
  }
  return flag<boolean>({
    key: spec.key,
    description: `${spec.linearId}: ${spec.description}`,
    defaultValue: spec.defaultValue,
    options: [
      { value: false, label: "Off" },
      { value: true, label: "On" },
    ],
    decide: () => resolveBool(spec.key, spec.envKey),
  });
}

// RAZ-22 - Personal-best ribbon in the completion modal.
// When on, the play page fetches the user's previous best time for the
// puzzle's difficulty and the completion modal renders a "New best!"
// ribbon if the current finish beats it.
export const pbRibbon = declareFlag("pb-ribbon");

// RAZ-19 - Haptic feedback on value placements (mobile / PWA polish).
// When on, the game store fires `navigator.vibrate(...)` after each
// value placement - short pulse on a legal move, longer pulse on a
// conflict. The user can still opt out via the in-app settings dialog
// (settings.haptics); the flag controls whether the feature exists at
// all. Feature-detected on the client so desktop is a no-op.
export const haptics = declareFlag("haptics");

// RAZ-27 - Server-side solve-time sanity check.
// When on, `submitCompletionAction` rejects any completion whose client
// `elapsedMs` exceeds `(now - saved_games.started_at) * 1.1 + 2s slack`.
// Defends against a client that inflates its timer (e.g. a buggy clock
// or a trivial spoof of the server action). The 10% + 2s slack absorbs
// normal clock skew between client and server. When a user has no
// saved_games row (unusually fast blitz solve that finished before the
// first autosave), the check is a no-op and the per-difficulty floor
// in TIME_FLOOR_MS still guards the leaderboard.
export const solveTimeSanity = declareFlag("solve-time-sanity");

// RAZ-16 - Auto-switch the "active" digit on the number pad after a
// placement exhausts the current digit. The pad tracks which digit was
// most recently placed and highlights it; when placing pushes that
// digit's on-board count to 9 (all placements made), the active-digit
// highlight auto-advances to the next digit that still has cells
// missing. Purely visual: input semantics (tap cell, tap digit) are
// unchanged. Helps power users see at a glance which digit to chase
// next without scanning remaining-count subscripts.
export const autoSwitchDigit = declareFlag("auto-switch-digit");

// RAZ-21 - Auto-pause on tab hidden or input idle. When on, the play
// page mounts a VisibilityListener that:
//   - pauses the game when `document.visibilitychange` fires with
//     `document.hidden === true`.
//   - after 90s of no pointer/keyboard input, auto-pauses as well.
//   - on return (tab re-focused), shows a sonner toast explaining the
//     pause and auto-resumes so the user doesn't have to tap pause.
// Leaderboard integrity: a player can no longer alt-tab away and let
// the timer run. Manual pause/unpause via the header button or Space
// is unaffected.
export const autoPause = declareFlag("auto-pause");

// RAZ-5 - Daily archive. When on, the router exposes /daily/[date] for
// any past date that exists in daily_puzzles, and the leaderboard page
// accepts a ?date=YYYY-MM-DD search param with prev/next navigation.
// Archive puzzles are playable for practice but completions are NOT
// submitted to completed_games (avoids retroactive leaderboard farming).
// Today's /daily and its leaderboard stay fully scored.
export const dailyArchive = declareFlag("daily-archive");

// RAZ-11 - Wordle-style share card. When on, the CompletionModal
// renders a "Share" button that builds a short text summary (mode,
// difficulty, time, mistakes, hints) + URL and copies it to the
// clipboard (or invokes navigator.share on mobile). The URL carries
// share-params so the puzzle and daily pages can request a dynamic
// OG image at /og/completion, producing rich previews on X / Discord
// / iMessage.
export const shareResult = declareFlag("share-result");

// RAZ-23 - Compact controls mode. When on, the settings dialog surfaces
// a "Compact controls" toggle that shrinks the number pad + control
// stacks to a uniform h-14 on mobile (instead of the default aspect-
// square which produces ~100px tall buttons on short viewports). The
// flag only gates the SETTING; users who leave the toggle off see the
// default layout. Low risk, but flagging keeps the option reversible
// from Edge Config in case the compact layout misbehaves on some
// device class.
export const compactControls = declareFlag("compact-controls");

// RAZ-17 - Jump-on-place. When on, the settings dialog exposes a
// "Jump to next empty peer" toggle; if the user enables it, inputDigit
// updates `selection` to the first empty peer (row/col/box, in index
// order) of the cell it just filled. Speeds keyboard solves by
// matching the natural "where else does this digit go?" scan.
// No-op on conflict placements (we don't want to drag the caret
// somewhere else if the user was correcting a mistake).
export const jumpOnPlace = declareFlag("jump-on-place");

// RAZ-20 - Long-press a number-pad button to toggle a note. The pad
// button starts a 400ms timer on pointerdown; if it elapses before
// pointerup, the digit is toggled as a note on the currently-selected
// empty cell and the normal "place a value" click is suppressed. Lets
// mobile players add a single pencil mark without round-tripping
// through notes mode. Flag keeps a kill switch if the gesture ends
// up conflicting with something device-specific we haven't thought of.
export const longPressNote = declareFlag("long-press-note");

// RAZ-26 - Dyslexia-friendly font option. When on, the settings dialog
// exposes a toggle that swaps the global UI font to OpenDyslexic. The
// font is self-hosted via @fontsource/opendyslexic so it's served from
// the same origin as the app (no CDN dependency, no extra CORS setup).
// The @font-face rule is always registered in globals.css so turning
// the setting on and off is instant - the browser only downloads the
// font file the first time an element that uses the family renders.
// Gate: flag hides the toggle entirely if off; if flag is on but the
// user never flips the toggle, there is zero perceptible cost.
export const dyslexiaFont = declareFlag("dyslexia-font");

// RAZ-34 - Quick-play sub-2-min Easy mode. When on, /play/quick is
// reachable and picks a random Easy puzzle (bucket 1), redirecting to
// /play/[id]?quick=1. The completion modal in quick mode offers a
// "Next puzzle" CTA that loops back to /play/quick for a fresh random.
// /leaderboard/quick ranks by count of Easy completions in the current
// ISO week rather than single fastest time. Flag gates both routes; a
// player who already discovered the URLs gets a 404 when it's off.
export const quickPlay = declareFlag("quick-play");

// RAZ-25 - Colorblind-safe palette picker. When on, the settings dialog
// surfaces a small dropdown that swaps `html[data-palette]` between the
// default theme, the Okabe-Ito red/green-safe palette, and a
// high-contrast variant. All swaps happen through CSS variable
// overrides in globals.css; no component logic changes. The flag is
// the kill switch — flipping it off forces every user back to the
// default palette even if they previously opted into another.
export const colorPalette = declareFlag("color-palette");

// RAZ-6 - Per-difficulty all-time leaderboards. When on, the
// /leaderboard/difficulty/[bucket] routes are reachable and a link
// cluster on /leaderboard surfaces them alongside the daily board.
// Each difficulty page shows best single time per user within the
// bucket (mode='random' only), with windows for all-time and the
// trailing 7 days, and pure/all-hints tabs. Flag off = routes 404
// and the cross-links disappear; daily board is untouched.
export const difficultyLeaderboards = declareFlag("difficulty-leaderboards");

// RAZ-35 - Paste-a-puzzle import. When on, /play/custom exposes a
// form that accepts 81 chars of 0..9/. (any whitespace/pipe/dash
// separators stripped), runs the backtracking solver to verify a
// solution exists, and redirects to /play/custom/[hash] for a
// practice session. No DB writes — no saved_games row, no
// completed_games submit, no leaderboard impact.
export const customPaste = declareFlag("custom-paste");

// RAZ-32 - Compare-to-field on daily completion. When on,
// `submitCompletionAction` computes a rank context for daily
// submits (total solvers so far today + how many the user beat on
// strict time) and returns it in the response. The CompletionModal
// renders a "You beat 73% of today's solvers" banner. No schema
// changes — powered entirely by the existing partial daily index.
export const dailyCompare = declareFlag("daily-compare");

// RAZ-13 - Share-a-puzzle challenge link. When on, the completion
// modal adds a "Challenge a friend" button that copies a URL like
// `/play/<id>?from=<username>` to the clipboard. Opening a puzzle
// with `?from=<username>` fetches the sender's best time via
// `getBestOnPuzzleByUsername` and renders a small banner above the
// board. Random-mode puzzles only. No schema changes.
export const challengeLink = declareFlag("challenge-link");

// RAZ-28 - Input-event log for replay + anti-cheat. When on, an
// opt-in settings toggle ("Record input for replay") appears; when
// the user opts in, the game store captures {cell, digit, ms} events
// into a bounded ring buffer and flushes them to `puzzle_attempts`
// on autosave + completion. Default off — this feature collects
// behavioral data and should be explicitly rolled out.
export const eventLog = declareFlag("event-log");

// RAZ-14 - Progressive hint disclosure. Splits the Hint action into
// three tiers (region nudge → technique + location → place digit) so
// players can learn WHY a move is forced instead of just seeing the
// answer. Still increments `hintsUsed` once per hint cycle for
// leaderboard integrity. Off = legacy one-shot reveal.
export const progressiveHints = declareFlag("progressive-hints");

// RAZ-9 - Print-friendly puzzle PDF. When on, the play screen surfaces a
// Printer icon that opens a dialog asking the player to pick board-content
// (original puzzle vs my progress) and pencil-marks (none, template =
// computed candidates, or my current notes). The selected combination
// is forwarded to /print/<puzzleId> which returns a server-rendered PDF
// via @react-pdf/renderer. Flag off = the icon is hidden and the /print
// route 404s.
export const printPuzzle = declareFlag("print-puzzle");

// RAZ-45 - Post-Game Breakdown. When on, the CompletionModal renders
// a deterministic insights panel summarising the run (pace, accuracy,
// assistance buckets) plus one concrete recommendation for what to
// try next. Pure client-side compute (see lib/sudoku/breakdown.ts) so
// flipping the flag off requires no other changes — the panel simply
// stops rendering.
export const postGameBreakdown = declareFlag("post-game-breakdown");

// RAZ-48 - Stuck Detection + Smart Rescue. When on, PlayClient mounts
// a tick-driven detector hook that watches the input-event ring
// buffer + conflict state and surfaces a small dismissible rescue
// chip when the player appears stuck. All detection is deterministic
// (lib/sudoku/stuck-detection.ts) so the chip is reproducible and
// flipping the flag off cleanly hides the chip without touching any
// gameplay state.
export const stuckRescue = declareFlag("stuck-rescue");

// RAZ-54 - Mode Presets (Learn / Classic / Speed / Zen). When on, the
// play home and the in-game settings dialog surface a one-tap preset
// picker that projects a deterministic settings bundle onto the
// per-device settings store. Flipping the flag off hides the picker
// entirely; the user keeps whatever settings they last had (the
// `selectedPreset` value remains persisted but is unused at the UI
// level — re-enabling the flag restores the picker pre-selected).
export const modePresets = declareFlag("mode-presets");

// RAZ-47 - Technique Journey. When on, /learn is reachable: a guided
// learning path that walks new players through each Sudoku deduction
// technique in turn. Each lesson presents a near-complete board
// centered on the lesson's technique; the player fills the empty
// cells and the lesson grades itself by comparing every placement to
// the puzzle's solution. Anonymous progress is persisted to
// localStorage so a logged-out player can still take the journey;
// signed-in user persistence + the unlock-graph view of the lesson
// list arrive in a follow-up. Flag off = /learn 404s and the play
// hub CTA disappears entirely.
export const techniqueJourney = declareFlag("technique-journey");

// RAZ-61 - Post-Game AI Debrief. When on, the completion modal renders
// an AI debrief card with three short bullets + a suggested next
// action, computed from the same deterministic breakdown the
// BreakdownPanel renders today. The flag is the UI-render gate; the
// actual model call is independently gated by the presence of
// OPENAI_API_KEY on the server, so flag-on-without-key shows the
// deterministic fallback copy (no tokens burned). NEVER sends the
// puzzle solution to the model.
export const aiDebrief = declareFlag("ai-debrief");

// RAZ-58 - Personal AI Coach. When on, the play screen shows a "Coach"
// button next to the timer; tapping it opens a dialog that fetches a
// short, context-aware coach card. The card may include a "Try this
// move" CTA that places a digit — but ONLY if the model's suggestion
// is verified against the deterministic solver server-side. Default
// off until P2 (beginner cohort default-on per the rollout plan in
// RAZ-58); flipping in Edge Config moves any cohort from beta to live
// without a deploy.
export const aiCoach = declareFlag("ai-coach");

// RAZ-15 - Per-cell mistake indicator. When on, the settings dialog
// exposes a "Show mistakes" toggle; if the user enables it AND the
// client has the puzzle solution (i.e. random non-daily puzzles where
// meta.solution is populated), wrongly-placed cells tint red in real
// time. Conflicts already tint red; this extends the treatment to
// wrong values that happen not to duplicate a peer. The flag gates
// only the UI toggle — when off, the feature is hidden and the store
// behaves as before. Daily puzzles never show mistake tint because
// the solution is kept server-side (otherwise we'd leak it).
export const showMistakes = declareFlag("show-mistakes");

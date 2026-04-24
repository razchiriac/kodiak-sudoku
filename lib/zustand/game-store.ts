"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  BOARD_SIZE,
  type Variant,
  buildFixedMask,
  clearCellNotes,
  clearNotesOnEmptyCells,
  computeAllCandidates,
  digitCounts,
  emptyNotes,
  parseBoard,
  peers,
  prunePeerNotes,
  toggleNote,
  notesMatchComputedCandidates,
} from "@/lib/sudoku/board";
import { findConflicts, isComplete, isLegalPlacement } from "@/lib/sudoku/validate";
import { nextHint, type HintSuggestion } from "@/lib/sudoku/solver";
import {
  emptyHistory,
  pushEntry,
  redo,
  undo,
  type HistoryEntry,
} from "@/lib/sudoku/history";
import { decodeNotes, encodeNotes } from "@/lib/sudoku/notes-codec";
import {
  appendEvent,
  type InputEvent,
  type InputEventKind,
} from "@/lib/sudoku/input-events";
import {
  applyPresetToSettings,
  settingsMatchPreset,
  type PresetId,
  PRESET_DEFINITIONS,
} from "./presets";
// RAZ-72: centralised haptic dispatcher + profile types. The store
// no longer owns vibration patterns directly — `playHaptic` reads the
// active profile and looks up the right pattern in lib/haptics.
import {
  playHaptic,
  type HapticEvent,
  type HapticProfileId,
} from "@/lib/haptics/patterns";

// Single Zustand store that owns ALL transient gameplay state. UI
// components subscribe to slices of this store; nothing about the game
// lives in React state so undo/redo and autosave are simple.
//
// We use `Uint8Array` and `Uint16Array` for board/notes because:
//   1) per-cell mutations are O(1) and allocation-free, and
//   2) cloning for history entries is cheap (162 bytes per board).
// React still re-renders correctly because each setter creates a fresh
// typed array reference.

export type GameMode = "value" | "notes";

// RAZ-81: per-session idempotency token. We use crypto.randomUUID() when
// available (every modern browser + Node 19+) and fall back to a
// timestamp-prefixed Math.random string only on the rare host that lacks
// it. The fallback is good enough because the token only needs to be
// unique per (user, puzzle) submit window — a partial UUID worth of
// entropy collides at roughly 1 in 10^15, which is well below the rate
// at which a single user submits the same puzzle. Kept as a tiny pure
// helper at module scope so the store itself stays framework-free.
function randomAttemptId(): string {
  try {
    const c = (
      typeof globalThis === "object" ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto : undefined
    );
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch {
    // crypto access can throw in some sandboxes — fall through to the
    // textual fallback rather than crashing the store.
  }
  // Fallback: timestamp + two Math.random fragments. Not crypto-grade
  // but more than enough entropy for a per-(user,puzzle,minute) token.
  const t = Date.now().toString(36);
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 10);
  return `${t}-${r1}-${r2}`;
}

// RAZ-25: supported sudoku-cell color palettes. We use a union of
// string literals rather than an enum (project rule: avoid enums) so
// the value round-trips through JSON for persistence without any
// serialization glue. Keep this list in sync with the CSS variable
// sets declared in globals.css under `html[data-palette=...]`.
export const PALETTES = ["default", "okabe-ito", "high-contrast"] as const;
export type Palette = (typeof PALETTES)[number];

export type GameMeta = {
  puzzleId: number;
  difficultyBucket: number;
  // 'random' or 'daily'. Determines submission rules and where the
  // completion is recorded. Stored in the store so the completion modal
  // can render the right CTA without prop-drilling.
  mode: "random" | "daily";
  // Solution for client-side hints. NULL for daily puzzles where the
  // server keeps the solution private.
  solution: string | null;
  // RAZ-18: Puzzle variant. "standard" is the classic 9x9 Sudoku;
  // "diagonal" adds two extra constraint diagonals. Defaults to
  // "standard" for backwards compatibility with existing saved games.
  variant?: import("@/lib/sudoku/board").Variant;
};

export type GameSnapshot = {
  meta: GameMeta;
  board: string;
  notesB64: string;
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  isPaused: boolean;
  isComplete: boolean;
  startedAt: number;
  // RAZ-81: client-generated idempotency token for this play session.
  // Sent with every submitCompletionAction call so the server can
  // dedupe retries — see drizzle/migrations/0008. Optional in the
  // type so snapshots persisted before RAZ-81 still rehydrate; the
  // store assigns a fresh UUID on resume when absent.
  attemptId?: string | null;
};

type GameState = {
  meta: GameMeta | null;
  // Original puzzle string (with zeros for blanks). Used to derive the
  // fixed mask and to reset the board.
  puzzle: string;
  board: Uint8Array;
  fixed: Uint8Array;
  notes: Uint16Array;
  selection: number | null;
  mode: GameMode;
  history: ReturnType<typeof emptyHistory>;
  conflicts: Set<number>;
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  isPaused: boolean;
  isComplete: boolean;
  // Wall-clock timestamp when the game started. Combined with elapsedMs
  // it lets us validate server-side that the user did not somehow submit
  // a faster time than physically possible.
  startedAt: number;
  // Settings the player can flip in the UI. Defaults are conservative.
  settings: {
    strict: boolean;
    highlightSameDigit: boolean;
    // RAZ-19: vibrate on value placements. Feature-detected at runtime
    // (navigator.vibrate) so desktop browsers silently skip it. Default
    // on so the PWA feels native out of the box; a player can still
    // mute it from the settings dialog.
    haptics: boolean;
    // RAZ-72: which intensity profile to use for vibrations when
    // `haptics` is on. "standard" preserves the patterns that shipped
    // before this field existed, so users with persisted state from
    // before RAZ-72 (no `hapticProfile` key → undefined after rehydrate)
    // get the legacy feel via the fallback inside `getProfile`. Persists
    // across sessions per device, like the rest of the settings slice.
    hapticProfile: HapticProfileId;
    // RAZ-23: compact controls. When true, the number pad uses a
    // uniform h-14 instead of the default aspect-square on mobile, so
    // the board gets more vertical room on ultra-tall phones. Default
    // false so existing players don't see a surprise layout change.
    // Gated behind the compact-controls feature flag at render time.
    compactControls: boolean;
    // RAZ-26: swap the global UI font to OpenDyslexic. Default off so
    // existing players see no visual change; the toggle is opt-in and
    // only surfaced when the feature flag is on. The @font-face rule
    // is always registered in globals.css but the actual font file is
    // only downloaded when an element using the family renders, so
    // the no-op cost for users who never flip the toggle is zero.
    dyslexiaFont: boolean;
    // RAZ-17: after a value placement, move the selection to the next
    // empty peer (first empty cell in index order among the 20 peers
    // of the placed cell). Default off so the caret never moves on its
    // own for players who haven't opted in. Gated behind the
    // jump-on-place feature flag at runtime.
    jumpOnPlace: boolean;
    // RAZ-15: when on, cells whose placed value does not match the
    // puzzle solution tint red in real time (a superset of conflict
    // highlighting — wrong values that don't happen to duplicate a
    // peer still show up). Default off so "find your own errors"
    // purists aren't nannied. Only meaningful when meta.solution is
    // populated (random puzzles); daily puzzles keep the solution
    // server-side so the flag has no visible effect there.
    showMistakes: boolean;
    // RAZ-54: feature flag mirror for Mode Presets. Controls whether
    // the play home + settings dialog renders the picker. When off,
    // the persisted `selectedPreset` value is left untouched but the
    // picker UI is hidden — flipping the flag back on restores the
    // pre-selected preset without a migration.
    // (declared in the featureFlags slice below — duplicated here as
    // a comment so the related settings field is easy to find).
    // RAZ-28: opt-in toggle for the input-event log. When true AND
    // the `event-log` feature flag is on, the store appends a compact
    // event record per value placement / erase / hint-placement into
    // the `events` ring buffer. Persisted so the choice survives
    // reloads. Default false — explicit opt-in as required by the
    // ticket because we're recording behavioral data. The `recording`
    // only starts on the NEXT mutation after the setting is flipped;
    // we don't backfill pre-opt-in events.
    recordEvents: boolean;
    // RAZ-42: when false, the play UI hides the "Auto-notes" control
    // and `autoFillNotes` no-ops. Purists can disable bulk candidate
    // fill without losing manual notes mode. Default true so existing
    // players keep the wand; undefined from old persisted state is
    // treated as enabled everywhere we branch.
    autoNotesEnabled: boolean;
    // RAZ-54: currently-active mode preset. Persisted so the choice
    // survives reloads. `null` means "the player has never picked a
    // preset" (legacy users / first run) and the picker UI shows
    // every option as unselected. `"custom"` means they DID pick
    // one but then tweaked an individual setting — the picker shows
    // the named preset highlight cleared and the player's tweaks
    // remain. The store auto-flips this to "custom" inside
    // `setSetting` when a manual change diverges from the active
    // preset's bundle. See `applyPreset` for the explicit setter.
    selectedPreset: PresetId | null;
    // RAZ-25: which color palette to use for the sudoku cells.
    // "default" keeps the shipped blue/red tokens. "okabe-ito" swaps
    // to the Okabe-Ito colorblind-safe palette (sky-blue / yellow /
    // bluish-green / vermillion) so peer / same-digit / conflict
    // highlights stay distinguishable under deuteranopia, protanopia,
    // and tritanopia. "high-contrast" uses strongly-saturated hues so
    // the grid is readable in bright sunlight or for low-vision users.
    // The selected value is applied via an attribute on <html>; see
    // globals.css for the overrides.
    palette: Palette;
    // RAZ-49: per-user opt-out for the deterministic Adaptive Coach
    // banner. Defaults true so the banner is on for everyone the
    // first time the `adaptive-coach` flag flips on. When false, the
    // banner never mounts regardless of the flag — same kill-switch
    // pattern we use for haptics and showMistakes. The settings
    // dialog renders the toggle only when the flag is on (so a
    // flag-off cohort doesn't see a control that does nothing).
    coachingTips: boolean;
  };
  // Feature-flag mirror. The *source* of truth is the server
  // (lib/flags.ts → Edge Config), which PlayClient evaluates server-
  // side and then forwards to `setFeatureFlag` on mount. We mirror the
  // resolved value in the store so gameplay reducers (inputDigit) can
  // cheaply read it without prop-drilling. Not persisted - we always
  // want the fresh server value on each page load, never a stale
  // localStorage copy.
  featureFlags: {
    haptics: boolean;
    // RAZ-16: when on, `inputDigit` maintains `activeDigit` and
    // auto-advances it once the placed digit is fully on the board.
    // When off, `activeDigit` stays null and the pad renders as before.
    autoSwitchDigit: boolean;
    // RAZ-23: when on, the settings dialog renders a "Compact controls"
    // toggle. The layout change itself also gates on this flag so a
    // user who turned compact ON can't be left with a broken layout if
    // we flip the flag off via Edge Config — it falls back to default.
    compactControls: boolean;
    // RAZ-26: when on, the settings dialog renders a "Dyslexia-friendly
    // font" toggle AND the DyslexiaFontLoader client component swaps
    // the UI font when the user opts in. Flag off means the toggle is
    // hidden and the default Geist font is used regardless of the
    // persisted per-user setting.
    dyslexiaFont: boolean;
    // RAZ-20: when on, holding a number-pad button for 400ms toggles
    // that digit as a note on the currently-selected empty cell
    // regardless of current mode. Flag off makes the pad button behave
    // as a plain tap (no timer, no suppression) — kill switch in case
    // the gesture conflicts with something we didn't anticipate on a
    // specific device.
    longPressNote: boolean;
    // RAZ-17: when on, inputDigit jumps the selection to the first
    // empty peer after placing a value. Default false so existing
    // players aren't surprised by a caret that moves on its own; a
    // power user opts in from the settings dialog.
    jumpOnPlace: boolean;
    // RAZ-15: when on, the settings dialog renders the "Show mistakes"
    // toggle. Whether mistakes are actually tinted at render time
    // ALSO depends on this flag — flipping the flag off via Edge
    // Config instantly hides the red tint for already-opted-in users
    // (the setting stays persisted, it just does nothing). Gives us a
    // clean kill switch if the derived-mistake computation ever
    // misbehaves.
    showMistakes: boolean;
    // RAZ-25: when on, the settings dialog renders the color palette
    // picker. The palette loader client component ALSO gates on this
    // flag before writing the `data-palette` attribute onto <html>,
    // so flipping the flag off forces everyone back to the default
    // palette regardless of their persisted choice.
    colorPalette: boolean;
    // RAZ-28: when on, the settings dialog renders the "Record input
    // for replay" toggle AND the store's mutation reducers append to
    // the events ring buffer. Flipping the flag off in Edge Config
    // hides the toggle AND stops recording immediately (the `events`
    // array simply stops growing on the next placement). Any events
    // already captured but not yet flushed stay in memory until the
    // next explicit drain call; that's fine — they'll be discarded
    // on the next startGame.
    eventLog: boolean;
    // RAZ-54: when on, Mode Presets are exposed in the play home and
    // settings dialog. When off, the picker is hidden everywhere and
    // `applyPreset` becomes a no-op at the UI layer (the action is
    // still callable but no entry point surfaces it). Lets us roll
    // the feature back from Edge Config without touching persisted
    // user state.
    modePresets: boolean;
    // RAZ-48: when on, the rescue chip is allowed to appear after a
    // stuck-detection signal trips. When off, `useStuckDetector`
    // short-circuits and the chip never mounts. Mirrored from
    // Edge Config via PlayClient — see `setFeatureFlag` calls.
    stuckRescue: boolean;
    // RAZ-49: when on, the deterministic coaching-tip banner
    // (`<CoachTipBanner />`) is allowed to mount under the board.
    // When off, the banner never appears regardless of the per-user
    // `coachingTips` setting — same kill-switch shape as
    // `stuckRescue`. Mirrored from Edge Config via PlayClient.
    adaptiveCoach: boolean;
    // RAZ-14: when on, the Hint button steps through three tiers (region
    // nudge → technique + location → place the digit). When off, every
    // `hint()` call applies the placement immediately — the pre-RAZ-14
    // behavior. We also gate the tier-advancing toasts on this flag so
    // an Edge-Config kill switch instantly reverts everyone.
    progressiveHints: boolean;
  };
  // RAZ-14: active progressive-hint session. A hint session starts on the
  // first click of the Hint button and advances through tiers on
  // subsequent clicks until tier 3 applies the placement. Any board /
  // selection change clears the session so a stale "try row 5" toast
  // never hangs around pointing at the wrong deduction. `hintsUsed`
  // still increments exactly once per session (on the starting click)
  // so leaderboard integrity is unchanged — the extra tiers don't count
  // as additional hints. Null when no session is in flight OR when the
  // progressive-hints flag is off (legacy mode always places in one
  // click and never populates this field).
  hintSession: {
    suggestion: HintSuggestion;
    // Currently-displayed tier. 1 = region nudge (we've toasted "try
    // column 7"); 2 = technique + cell (we've toasted "naked single at
    // r3c7"). Tier 3 = place the digit, which also CLEARS the session.
    tier: 1 | 2;
  } | null;
  // RAZ-28: in-memory ring buffer of user input events. Capped at
  // EVENT_BUFFER_CAP entries (see input-events.ts). Contents are
  // drained to the server on save / submit via `drainEvents()`.
  // NOT persisted — the buffer's whole point is "since last flush",
  // and rehydrating events across page reloads would double-count
  // them. We treat a page reload as an implicit flush point where
  // anything in-memory is gone. Follow-up work could persist the
  // buffer across reloads for more resilient replays; out of scope
  // for v1.
  //
  // The buffer is immutable: each append returns a fresh array ref
  // so React subscribers re-render correctly. Performance is fine
  // even with n=1024 because this path runs once per user click.
  events: InputEvent[];
  // RAZ-28: monotonic sequence number incremented by `drainEvents()`.
  // Attached to each flush's payload so the server can order multiple
  // rows belonging to the same attempt in the right sequence without
  // relying on `created_at` clock precision. Resets to 0 on
  // startGame / resumeFromSnapshot.
  eventSeq: number;
  // RAZ-16: the digit most recently placed by a value-mode `inputDigit`
  // call, or null if no value has been placed yet (or the feature flag
  // is off). Number pad highlights the matching button. Auto-advances
  // to the next still-incomplete digit once placement exhausts the
  // current one (all 9 copies on the board). Not persisted - always
  // starts null on a page load.
  activeDigit: number | null;
  // RAZ-75: monotonic activity timestamp (in elapsedMs units) updated
  // on EVERY player-driven board mutation — value placement, erase,
  // notes toggle, bulk auto-notes, AND hint-applied placements. We
  // need this as a separate field (rather than reusing the events
  // ring buffer) because the buffer is double-gated on the
  // `event-log` Edge Config flag AND the per-user `recordEvents`
  // setting (default false), so the buffer is empty for most
  // players. The idle detector previously inferred "last move" from
  // the buffer's tail and silently fell back to `elapsedMs` when
  // empty, which is why "Xs since last move" never reset on input.
  // Null means "the player has not done anything yet this attempt"
  // — the idle detector treats that as "use elapsedMs as the anchor"
  // so the warmup-then-prompt UX for a fresh page-open still works.
  lastInputAtMs: number | null;
  // RAZ-81: idempotency token for the active play session. Generated on
  // startGame / resumeFromSnapshot and threaded into every
  // submitCompletionAction call so a flaky-network retry storm never
  // inserts a second `completed_games` row for the same solve. Null
  // before a game has been started (the snapshot accessor returns null
  // in that case anyway, so this should never leak to the server).
  attemptId: string | null;
  // RAZ-49: elapsedMs at the moment the most-recent hint was actually
  // placed on the board. Set inside `applyHintPlacement` (the single
  // funnel for hint placements — both progressive tier-3 and legacy
  // one-shot reveals route through it). Null when no hint has been
  // applied yet this attempt; reset by startGame / resumeFromSnapshot.
  // Powers the coach-tips technique-followup detector.
  lastHintAtMs: number | null;
  // RAZ-49: technique of the most-recent hint placement (carried
  // through from `HintSuggestion.technique`). Combined with
  // `lastHintAtMs` so the technique-followup tip can render
  // technique-specific copy without re-running the solver. Null
  // before any hint has been used. When the last hint was a
  // "from-solution" fallback the value is recorded as-is and the
  // tip detector decides not to surface a teachable message.
  lastHintTechnique:
    | "naked-single"
    | "hidden-single"
    | "from-solution"
    | null;
};

type GameActions = {
  // Initialize a new game from a fresh puzzle. Resets all transient state.
  startGame: (args: { meta: GameMeta; puzzle: string }) => void;
  // Resume a saved game from a server snapshot.
  resumeFromSnapshot: (snapshot: GameSnapshot, puzzle: string) => void;
  // Snapshot for autosave / completion submission.
  snapshot: () => GameSnapshot | null;

  selectCell: (index: number | null) => void;
  moveSelection: (dx: number, dy: number) => void;
  setMode: (mode: GameMode) => void;
  toggleMode: () => void;

  inputDigit: (digit: number) => void;
  // RAZ-20: unconditionally toggle `digit` as a note on the currently
  // selected empty cell. Unlike inputDigit in notes mode, this never
  // mutates the cell's value and never depends on the current mode -
  // called from long-press while the user is in value mode so a single
  // pencil mark can be added without a mode round-trip. No-ops if
  // there is no selection, the selection is a fixed clue, or the cell
  // already has a value (placing a value removes notes, so an existing
  // value means notes would be meaningless).
  toggleNoteOnSelection: (digit: number) => void;
  eraseSelection: () => void;
  // RAZ-43: if notes already match a full auto-candidate grid, clear
  // pencil marks on all empty cells; else fill with computed
  // candidates. Each action is one notes-bulk history step.
  autoFillNotes: () => void;

  undo: () => void;
  redo: () => void;

  hint: () => Promise<void>;
  // Request a hint from the server (for daily puzzles where we don't have
  // the solution client-side). Caller injects the fetcher so the store
  // stays framework-agnostic.
  setRemoteHintFetcher: (
    fn: (board: string, selected: number | null) => Promise<{ index: number; digit: number }>,
  ) => void;

  togglePause: () => void;
  // Set the paused state directly. Used by the auto-pause listener
  // (RAZ-21) which needs idempotent pause/resume rather than a toggle.
  setPaused: (value: boolean) => void;
  tick: (ms: number) => void;

  setSetting: <K extends keyof GameState["settings"]>(
    key: K,
    value: GameState["settings"][K],
  ) => void;

  // RAZ-54: project a Mode Preset's settings bundle onto the per-
  // device settings slice in one call. Updates `selectedPreset` to
  // the chosen id and merges the preset's projection over the
  // current settings (keys outside the preset's bundle are
  // preserved). No-op when called with an unknown preset id (i.e.
  // "custom" or anything not in PRESET_DEFINITIONS); use
  // `setSetting("selectedPreset", "custom")` for the synthetic
  // "the user has tweaked things" case.
  applyPreset: (presetId: PresetId) => void;

  // Mirror a resolved server-side feature flag into the store. Called
  // once on mount from PlayClient with the value PlayClient received
  // from the Server Component. No-op if the value is unchanged.
  setFeatureFlag: <K extends keyof GameState["featureFlags"]>(
    key: K,
    value: GameState["featureFlags"][K],
  ) => void;

  // Returns counts for digits 1..9 currently placed on the board. Used by
  // the number pad to show "remaining" badges.
  getDigitCounts: () => number[];

  // RAZ-28 — Extract the current event buffer and clear it. Returns a
  // tuple of the events AND the sequence number at the time of drain,
  // so callers can hand them to the server action verbatim. The seq
  // is bumped AFTER the drain so a subsequent drain reflects the
  // NEXT batch's seq (i.e. drain #0 has seq=0, drain #1 has seq=1).
  // No-op returning an empty batch when the buffer is empty — callers
  // can still send a "completion" marker with an empty events array
  // if they want to mark the end of an attempt.
  drainEvents: () => { events: InputEvent[]; seq: number };
};

const INITIAL: GameState = {
  meta: null,
  puzzle: "",
  board: new Uint8Array(BOARD_SIZE),
  fixed: new Uint8Array(BOARD_SIZE),
  notes: emptyNotes(),
  selection: null,
  mode: "value",
  history: emptyHistory(),
  conflicts: new Set(),
  elapsedMs: 0,
  mistakes: 0,
  hintsUsed: 0,
  isPaused: false,
  isComplete: false,
  startedAt: 0,
  settings: {
    strict: false,
    highlightSameDigit: true,
    // Haptics default ON because the whole feature is flag-gated anyway;
    // if the flag is off we never vibrate regardless of this bool.
    haptics: true,
    // RAZ-72: default to "standard" so existing players experience the
    // exact same patterns shipped before profiles existed. The picker
    // in the settings dialog lets them try "subtle" or "strong".
    hapticProfile: "standard",
    // RAZ-23: default off so we don't surprise existing players with a
    // smaller pad; the setting is fully opt-in via the settings dialog.
    compactControls: false,
    // RAZ-26: default off so the default Geist font stays the stock
    // experience. Dyslexia-readers opt in once via the settings dialog.
    dyslexiaFont: false,
    // RAZ-17: default off so existing players see no caret movement
    // change. Opt in via the settings dialog. The feature only runs
    // when both the user setting AND the feature flag are true.
    jumpOnPlace: false,
    // RAZ-15: default off — the "purist" experience is the canonical
    // Sudoku one where the player hunts their own errors. Opting in
    // via the settings dialog turns on the red tint for wrong values.
    showMistakes: false,
    // RAZ-25: default to the shipped palette. Users opt into a
    // colorblind-safe or high-contrast palette explicitly. Persisted
    // so the choice survives reloads.
    palette: "default",
    // RAZ-28: default off — ticket explicitly calls this an opt-in
    // feature, so a user has to flip it on from the settings dialog
    // before any events are captured. Paired with the `event-log`
    // feature flag at the store layer.
    recordEvents: false,
    // RAZ-42: default on — the bulk auto-notes action stays available
    // until the user explicitly turns it off in Settings.
    autoNotesEnabled: true,
    // RAZ-54: default null — first-run users haven't opted into a
    // preset yet, so the picker UI shows nothing highlighted and the
    // app behaves with the canonical defaults above. As soon as a
    // user picks a preset (or tweaks any setting), this field flips
    // to a concrete value and persists per-device.
    selectedPreset: null,
    // RAZ-49: default true — adaptive coach is on for everyone the
    // first time the flag rolls out; players can opt out per-device
    // from the settings dialog. The flag-off path hides the entire
    // surface (including this toggle).
    coachingTips: true,
  },
  featureFlags: {
    haptics: false,
    autoSwitchDigit: false,
    compactControls: false,
    dyslexiaFont: false,
    longPressNote: false,
    jumpOnPlace: false,
    showMistakes: false,
    colorPalette: false,
    // RAZ-14: default false so the legacy one-click-reveal path runs
    // until PlayClient has mirrored the server-resolved flag value.
    // The play-client effect hydrates this almost immediately on mount.
    progressiveHints: false,
    // RAZ-28: default false — feature is off by default and hydrates
    // to the resolved Edge Config value on mount. When it flips on
    // mid-session, recording starts on the NEXT mutation (no
    // retroactive capture of moves the user made before opting in).
    eventLog: false,
    // RAZ-54: default false — hydrated to the resolved Edge Config
    // value on mount by PlayClient (and by the play home page for
    // the picker there). Off = picker is hidden and the persisted
    // `selectedPreset` setting is unused at the UI layer.
    modePresets: false,
    // RAZ-48: default false — hydrated by PlayClient on mount from
    // the resolved `stuck-rescue` Edge Config flag. Off = the rescue
    // chip never mounts.
    stuckRescue: false,
    // RAZ-49: default false — hydrated by PlayClient on mount from
    // the resolved `adaptive-coach` Edge Config flag. Off = the
    // coach-tip banner never mounts.
    adaptiveCoach: false,
  },
  hintSession: null,
  events: [],
  eventSeq: 0,
  activeDigit: null,
  // RAZ-75: starts null — see field comment in GameState.
  lastInputAtMs: null,
  // RAZ-81: starts null — see field comment in GameState. startGame /
  // resumeFromSnapshot overwrite this with a fresh UUID before the
  // game becomes interactive.
  attemptId: null,
  // RAZ-49: start with no hint context. applyHintPlacement assigns
  // both fields when a hint is placed; startGame / resumeFromSnapshot
  // reset them via the ...INITIAL spread.
  lastHintAtMs: null,
  lastHintTechnique: null,
};

// RAZ-16 helper. Given the digit that was just placed and the post-
// placement digit counts (index 1..9 = how many of that digit are on
// the board), return the digit the number pad should highlight next.
// Rules:
//   - If the placed digit still has slots remaining, stay on it.
//   - If the placed digit is now fully placed (9-on-board), advance to
//     the smallest higher-numbered digit that is still incomplete.
//     Wrap around to 1..(placed-1) so 9 → 1..8.
//   - If every digit is complete (game finished), return null.
function nextActiveDigit(placed: number, counts: number[]): number | null {
  if (counts[placed] < 9) return placed;
  for (let offset = 1; offset <= 9; offset++) {
    const d = ((placed - 1 + offset) % 9) + 1;
    if (counts[d] < 9) return d;
  }
  return null;
}

// RAZ-17 helper. Given the cell we just placed into, the post-placement
// board, and the fixed mask, return the index of the first empty peer
// (same row / col / box) that isn't a clue — or null if every peer is
// either filled or fixed. We iterate in stable index order (0..80) so
// repeated placements scan the grid in a predictable pattern and the
// behavior is easy to reason about. The peers() helper already excludes
// the placed cell itself, so no self-check is needed.
function nextEmptyPeer(
  placedIndex: number,
  board: Uint8Array,
  fixed: Uint8Array,
  variant?: Variant,
): number | null {
  const candidates = peers(placedIndex, variant);
  for (const p of candidates) {
    if (fixed[p]) continue;
    if (board[p] !== 0) continue;
    return p;
  }
  return null;
}

// Fire a short haptic pulse on a successful placement, a longer one
// when the placement creates a conflict. RAZ-72 moved the actual
// vibration patterns into `lib/haptics/patterns.ts` — this helper now
// just resolves the gate (flag + setting) and forwards to `playHaptic`.
// Keeping a single chokepoint in the store means every gameplay event
// that wants to vibrate goes through the same enable check, so a future
// kill-switch only needs to change one place.
function fireGameHaptic(state: GameState, event: HapticEvent) {
  const enabled =
    state.featureFlags.haptics && state.settings.haptics !== false;
  // playHaptic handles the navigator-undefined / no-vibrate / throw
  // cases internally, so we don't repeat that defensive code here.
  // `!== false` rather than `=== true` so existing players whose
  // persisted settings blob predates the haptics field still get the
  // default-on behavior without needing a persist version migration.
  playHaptic(event, state.settings.hapticProfile ?? "standard", enabled);
}

let remoteHintFetcher:
  | ((board: string, selected: number | null) => Promise<{ index: number; digit: number }>)
  | null = null;

// RAZ-28 — Pure helper the reducers use to decide whether to push a
// new event onto the buffer. Both the feature flag AND the per-user
// setting must be true. Returns the next events array (or the same
// reference when recording is disabled, so callers can write
// `events: maybeRecord(s, ...)` without a conditional branch in
// every reducer). Takes only the slice of state it needs rather than
// the whole state object so it stays easy to unit-test.
function maybeRecord(
  s: Pick<
    GameState,
    "events" | "elapsedMs" | "featureFlags" | "settings"
  >,
  kind: InputEventKind,
  cell: number,
  digit: number,
): InputEvent[] {
  if (!s.featureFlags.eventLog) return s.events;
  if (!s.settings.recordEvents) return s.events;
  return appendEvent(s.events, {
    c: cell,
    d: digit,
    t: s.elapsedMs,
    k: kind,
  });
}

// RAZ-14 — shared placement helper used by BOTH the legacy one-shot
// hint path AND the tier-3 branch of the progressive hint flow. Lives
// outside the store factory so both branches share the same undo-entry
// shape (we regressed on this once before; a single helper guarantees
// they can't drift). Not exported — callers should call `hint()`.
//
// Params:
//   s                — the full state captured before the placement
//   suggestion       — {index, digit} to place
//   opts.incrementCounter — bump `hintsUsed` by 1 (legacy) vs leave it
//                           alone (tier-3, already bumped at tier-1)
//   opts.clearSession — wipe the hintSession (tier-3) vs leave it null
//                       (legacy, which never populated it anyway)
//   set              — the zustand set callback
function applyHintPlacement(
  s: GameState,
  // RAZ-49: callers now pass the resolved technique alongside the
  // (cell, digit) so the adaptive coach can render a
  // technique-specific follow-up tip without re-running the solver.
  // Optional because legacy callers + the remote-fetch fallback may
  // not have a richer technique label; in those cases we fall back
  // to "from-solution" which the tip engine treats as a generic
  // "double-check the cell" nudge.
  suggestion: {
    index: number;
    digit: number;
    technique?: "naked-single" | "hidden-single" | "from-solution";
  },
  opts: { incrementCounter: boolean; clearSession: boolean },
  set: (partial: Partial<GameState>) => void,
): void {
  const v = s.meta?.variant;
  const idx = suggestion.index;
  const prevValue = s.board[idx];
  const board = new Uint8Array(s.board);
  board[idx] = suggestion.digit;
  const prevNotes = new Uint16Array(s.notes);
  let notes = clearCellNotes(s.notes, idx);
  notes = prunePeerNotes(notes, idx, suggestion.digit, v);
  const entry: HistoryEntry = {
    kind: "value",
    index: idx,
    prevValue,
    nextValue: suggestion.digit,
    prevNotes,
    nextNotes: notes,
  };
  const activeDigit = s.featureFlags.autoSwitchDigit
    ? nextActiveDigit(suggestion.digit, digitCounts(board))
    : null;
  // RAZ-72: a hint-applied placement that solves the puzzle should
  // still fire the celebratory "complete" pattern; otherwise we fire
  // the dedicated "hint" pattern so the player can tell by feel that
  // the move came from the assistant rather than their own placement.
  const completed = isComplete(board, v);
  fireGameHaptic(s, completed ? "complete" : "hint");
  set({
    board,
    notes,
    selection: idx,
    hintsUsed: opts.incrementCounter ? s.hintsUsed + 1 : s.hintsUsed,
    hintSession: opts.clearSession ? null : s.hintSession,
    activeDigit,
    history: pushEntry(s.history, entry),
    conflicts: findConflicts(board, v),
    isComplete: completed,
    // RAZ-28: log hint-driven placements under kind "h" so replay /
    // anti-cheat analysis can distinguish them from the player's own
    // placements (e.g. a "perfect run with zero hints" signal relies
    // on being able to filter these out).
    events: maybeRecord(s, "h", idx, suggestion.digit),
    // RAZ-75: a hint placement is still an action — it should reset
    // the "Xs since last move" idle anchor so the rescue chip
    // doesn't immediately re-fire after the player accepts one.
    lastInputAtMs: s.elapsedMs,
    // RAZ-49: stash the hint context so the adaptive coach's
    // technique-followup detector can render technique-specific
    // copy without re-running the solver. We always record the
    // raw technique (including "from-solution") and let the tip
    // engine decide whether to surface it — keeps the store
    // dumb and the policy in one place.
    lastHintAtMs: s.elapsedMs,
    lastHintTechnique: suggestion.technique ?? "from-solution",
  });
}

export const useGameStore = create<GameState & GameActions>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      startGame: ({ meta, puzzle }) => {
        const board = parseBoard(puzzle);
        const fixed = buildFixedMask(puzzle);
        set({
          ...INITIAL,
          meta,
          puzzle,
          board,
          fixed,
          notes: emptyNotes(),
          selection: null,
          history: emptyHistory(),
          conflicts: new Set(),
          startedAt: Date.now(),
          // RAZ-81: a fresh play session gets a fresh idempotency token.
          // randomAttemptId() handles the SSR / no-crypto edge case so
          // this never throws on a server-render pass.
          attemptId: randomAttemptId(),
          // RAZ-28: fresh attempt starts with an empty buffer and
          // resets the flush sequence. Any pending events from a
          // previous attempt are discarded — they're either already
          // flushed or belong to an abandoned game.
          events: [],
          eventSeq: 0,
          settings: get().settings, // preserve user prefs across games
          // Feature flags are server-driven and re-applied on mount, but
          // preserving them avoids a one-frame flicker where a flag
          // briefly resets to its INITIAL value between startGame() and
          // the PlayClient effect that re-injects it.
          featureFlags: get().featureFlags,
        });
      },

      resumeFromSnapshot: (snapshot, puzzle) => {
        const fixed = buildFixedMask(puzzle);
        const board = parseBoard(snapshot.board);
        const notes = decodeNotes(snapshot.notesB64);
        set({
          ...INITIAL,
          meta: snapshot.meta,
          puzzle,
          board,
          fixed,
          notes,
          elapsedMs: snapshot.elapsedMs,
          mistakes: snapshot.mistakes,
          hintsUsed: snapshot.hintsUsed,
          isPaused: snapshot.isPaused,
          isComplete: snapshot.isComplete,
          startedAt: snapshot.startedAt,
          // RAZ-81: prefer the attemptId carried in the snapshot (set by
          // a previous startGame on this device, persisted via the
          // partialize block below). When absent (server-resume for a
          // signed-in user, or a snapshot from before this field
          // existed), generate a fresh one. The "absent" case loses
          // dedupe across page reloads but still dedupes the much
          // more common in-page-load retry storm.
          attemptId: snapshot.attemptId ?? randomAttemptId(),
          // RAZ-28: resumed attempts start with an empty event buffer.
          // We can't replay the events the previous session captured
          // because they're either already flushed to the server OR
          // were lost to a refresh; either way we begin recording
          // fresh from here.
          events: [],
          eventSeq: 0,
          settings: get().settings,
          featureFlags: get().featureFlags,
        });
        set((s) => ({ ...s, conflicts: findConflicts(s.board, s.meta?.variant) }));
      },

      snapshot: () => {
        const s = get();
        if (!s.meta) return null;
        return {
          meta: s.meta,
          board: Array.from(s.board).join(""),
          notesB64: encodeNotes(s.notes),
          elapsedMs: s.elapsedMs,
          mistakes: s.mistakes,
          hintsUsed: s.hintsUsed,
          isPaused: s.isPaused,
          isComplete: s.isComplete,
          startedAt: s.startedAt,
          // RAZ-81: include the per-session idempotency token so callers
          // (notably submitCompletionAction in play-client) can pass it
          // through to the server. Reading it off the snapshot rather
          // than the store directly keeps every call site that already
          // takes a snapshot working without an extra selector.
          attemptId: s.attemptId,
        };
      },

      selectCell: (index) =>
        // RAZ-14: clearing hintSession when the user re-focuses is an
        // explicit "I've moved on" signal; otherwise a stale tier-1 toast
        // would linger pointing at a row the user is no longer inspecting.
        set({ selection: index, hintSession: null }),

      moveSelection: (dx, dy) => {
        const s = get();
        const cur = s.selection ?? 40; // center
        const row = Math.floor(cur / 9);
        const col = cur % 9;
        const nr = (row + dy + 9) % 9;
        const nc = (col + dx + 9) % 9;
        set({ selection: nr * 9 + nc, hintSession: null });
      },

      setMode: (mode) => set({ mode }),
      toggleMode: () => set((s) => ({ mode: s.mode === "value" ? "notes" : "value" })),

      inputDigit: (digit) => {
        const s = get();
        const v = s.meta?.variant;
        if (s.isComplete || s.isPaused) return;
        const idx = s.selection;
        if (idx == null) return;
        if (s.fixed[idx]) return; // never overwrite a clue
        if (digit < 1 || digit > 9) return;

        if (s.mode === "notes") {
          // Only allow notes on empty cells; placing a value should clear
          // notes but flipping a note in a filled cell is meaningless.
          if (s.board[idx] !== 0) return;
          const prevMask = s.notes[idx];
          const nextNotes = toggleNote(s.notes, idx, digit);
          const entry: HistoryEntry = {
            kind: "note",
            index: idx,
            prevMask,
            nextMask: nextNotes[idx],
          };
          set({
            notes: nextNotes,
            history: pushEntry(s.history, entry),
            // RAZ-14: board-affecting action → abandon any pending
            // progressive hint. The tier-2 "naked single at r3c7"
            // message would likely be wrong after the user edits notes.
            hintSession: null,
            // RAZ-75: notes-mode toggle is also "the player did
            // something" — keeps the idle detector quiet for players
            // who solve primarily via pencil marks.
            lastInputAtMs: s.elapsedMs,
          });
          return;
        }

        // Value mode: maybe block if strict + illegal.
        if (s.settings.strict && !isLegalPlacement(s.board, idx, digit, v)) return;

        const prevValue = s.board[idx];
        if (prevValue === digit) return; // no-op
        const board = new Uint8Array(s.board);
        board[idx] = digit;

        // Snapshot the full notes buffer before mutation so the history
        // entry can restore it verbatim on undo. We need the snapshot
        // BEFORE clearCellNotes / prunePeerNotes because both return new
        // buffers but we want the original state for undo.
        const prevNotes = new Uint16Array(s.notes);

        // Clear notes on the cell we just filled, then prune the newly
        // placed digit from every peer's notes. Pruning is now
        // unconditional: placing a digit always invalidates that digit
        // as a candidate in its row, column, and box.
        let notes = clearCellNotes(s.notes, idx);
        notes = prunePeerNotes(notes, idx, digit, v);

        // Increment mistakes if the placement creates a conflict.
        const isConflict = !isLegalPlacement(s.board, idx, digit, v);
        let mistakes = s.mistakes;
        if (isConflict) mistakes++;

        // RAZ-19 + RAZ-72 haptics. We fire one of three events:
        //   - "complete" when this placement just finished the puzzle
        //     (most celebratory pattern; takes precedence over the
        //     "place" tick since the player just won).
        //   - "conflict" when the placement creates a rule violation
        //     AND the player has opted in to seeing mistakes — see
        //     RAZ-77 below.
        //   - "place" otherwise (the normal subtle tick).
        // `fireGameHaptic` handles flag/setting/feature-detect gating
        // and looks up the active profile's pattern from
        // lib/haptics/patterns.
        //
        // RAZ-77: when the player has `showMistakes` turned OFF, a
        // distinct "conflict" buzz on a wrong placement is an
        // information leak — the visual is intentionally hidden but
        // the haptic still tells them "that one was wrong". Treat a
        // mistake exactly like a normal placement in that case so the
        // setting is respected end-to-end. The mistake counter still
        // increments (it's invisible until the player views their
        // post-game stats / completion modal, by which point the
        // round is over).
        const showMistakesOn =
          s.featureFlags.showMistakes && s.settings.showMistakes === true;
        const willComplete = !isConflict && isComplete(board, v);
        const event: HapticEvent = willComplete
          ? "complete"
          : isConflict && showMistakesOn
            ? "conflict"
            : "place";
        fireGameHaptic(s, event);

        // RAZ-16: compute the next active digit for the number pad. We
        // do this after `board` has been updated so the post-placement
        // counts are correct. The flag-off case short-circuits to null
        // so turning the feature off at runtime cleanly removes the
        // highlight.
        const activeDigit = s.featureFlags.autoSwitchDigit
          ? nextActiveDigit(digit, digitCounts(board))
          : null;

        const entry: HistoryEntry = {
          kind: "value",
          index: idx,
          prevValue,
          nextValue: digit,
          prevNotes,
          // notes is already a fresh buffer from clearCellNotes/prune,
          // so we can keep the reference. The store never mutates it.
          nextNotes: notes,
        };
        // RAZ-17: jump-on-place. If the user opted into this AND the
        // server flag allows it, advance the selection to the first
        // empty, non-fixed peer (scanning the 20 peers in their stable
        // index order). We skip the jump on a conflict placement — the
        // caret moving away from a mistake would be disorienting; the
        // player probably wants to stay on the bad cell to fix it.
        // We also skip when the placement is the winning move, because
        // a selection move right as the completion modal opens is
        // visually noisy.
        const shouldJump =
          s.featureFlags.jumpOnPlace &&
          s.settings.jumpOnPlace === true &&
          !isConflict &&
          !isComplete(board, v);
        const nextSelection = shouldJump
          ? nextEmptyPeer(idx, board, s.fixed, v) ?? s.selection
          : s.selection;

        const next = {
          ...s,
          board,
          notes,
          mistakes,
          activeDigit,
          selection: nextSelection,
          history: pushEntry(s.history, entry),
        };
        set({
          ...next,
          conflicts: findConflicts(next.board, v),
          isComplete: isComplete(next.board, v),
          // RAZ-14: a user placement invalidates any in-flight
          // progressive hint because the whole board state changed.
          hintSession: null,
          // RAZ-28: record a "v" event for every user-driven value
          // placement. Conflicting placements ARE recorded because
          // the anti-cheat / replay analysis cares about the full
          // stream of clicks, not just the correct ones.
          events: maybeRecord(s, "v", idx, digit),
          // RAZ-75: stamp the activity anchor so the idle detector
          // (`useStuckDetector`) sees a fresh "last move" timestamp
          // even when event recording is disabled.
          lastInputAtMs: s.elapsedMs,
        });
      },

      toggleNoteOnSelection: (digit) => {
        const s = get();
        if (s.isComplete || s.isPaused) return;
        const idx = s.selection;
        if (idx == null) return;
        if (s.fixed[idx]) return;
        // Long-press on a pad button while the selected cell already
        // has a value is a no-op: placing a value clears notes on that
        // cell by design, so toggling a note there would be both
        // meaningless and inconsistent with the rest of the notes API.
        // The caller (pad button) is responsible for any UI affordance
        // in this case (e.g. a subtle "no-op" hint); the store keeps
        // quiet.
        if (s.board[idx] !== 0) return;
        if (digit < 1 || digit > 9) return;

        // Same structure as the notes branch of inputDigit so undo/redo
        // sees a uniform shape: a `note` history entry whose prev/next
        // masks capture exactly the bit that flipped.
        const prevMask = s.notes[idx];
        const nextNotes = toggleNote(s.notes, idx, digit);
        const entry: HistoryEntry = {
          kind: "note",
          index: idx,
          prevMask,
          nextMask: nextNotes[idx],
        };
        // RAZ-14: note toggles invalidate a pending hint for the same
        // reason inputDigit does — the board-derived suggestion could
        // now be stale relative to the player's new pencil marks.
        set({
          notes: nextNotes,
          history: pushEntry(s.history, entry),
          hintSession: null,
          // RAZ-75: long-press note toggle counts as activity.
          lastInputAtMs: s.elapsedMs,
        });
      },

      eraseSelection: () => {
        const s = get();
        const v = s.meta?.variant;
        if (s.isComplete || s.isPaused) return;
        const idx = s.selection;
        if (idx == null) return;
        if (s.fixed[idx]) return;
        const prevValue = s.board[idx];
        const prevMask = s.notes[idx];
        if (prevValue === 0 && prevMask === 0) return;

        const board = new Uint8Array(s.board);
        board[idx] = 0;
        const prevNotes = new Uint16Array(s.notes);
        const notes = clearCellNotes(s.notes, idx);

        const entry: HistoryEntry = {
          kind: "value",
          index: idx,
          prevValue,
          nextValue: 0,
          prevNotes,
          nextNotes: notes,
        };
        set({
          board,
          notes,
          history: pushEntry(s.history, entry),
          conflicts: findConflicts(board, v),
          isComplete: isComplete(board, v),
          // RAZ-14: erasing a cell obviously invalidates a pending
          // hint session.
          hintSession: null,
          // RAZ-28: erase is a real input event — record with digit=0
          // as the "empty cell" marker. Useful for replays so the
          // playback can re-blank the cell, and for anti-cheat rate
          // analysis (an unusually fast erase-then-fill pattern is a
          // telltale of a brute-force script).
          events: maybeRecord(s, "e", idx, 0),
          // RAZ-75: erase counts as activity.
          lastInputAtMs: s.elapsedMs,
        });
      },

      autoFillNotes: () => {
        const s = get();
        // RAZ-42: respect the settings toggle even if something
        // called the action without going through the visible button.
        if (s.settings.autoNotesEnabled === false) return;
        if (s.isComplete || s.isPaused) return;
        const v = s.meta?.variant;
        const prevNotes = new Uint16Array(s.notes);
        const nextNotes = notesMatchComputedCandidates(s.board, prevNotes, v)
          ? clearNotesOnEmptyCells(s.board, prevNotes)
          : computeAllCandidates(s.board, v);

        // Skip if nothing actually changed — avoids polluting the undo
        // stack with no-op entries (e.g. redundant tap).
        let changed = false;
        for (let i = 0; i < BOARD_SIZE; i++) {
          if (prevNotes[i] !== nextNotes[i]) {
            changed = true;
            break;
          }
        }
        if (!changed) return;

        const entry: HistoryEntry = {
          kind: "notes-bulk",
          prevNotes,
          nextNotes,
        };
        // RAZ-14: bulk-notes rewrite implies the player wants fresh
        // candidates — a pre-existing hint session pointing at a cell
        // whose candidate set just changed would be misleading.
        set({
          notes: nextNotes,
          history: pushEntry(s.history, entry),
          hintSession: null,
          // RAZ-75: bulk auto-notes is a deliberate player action.
          lastInputAtMs: s.elapsedMs,
        });
      },

      undo: () => {
        const s = get();
        const v = s.meta?.variant;
        const u = undo(s.history);
        if (!u) return;
        const e = u.entry;
        // RAZ-75: undo is a player action; capture the activity
        // anchor once for whichever branch fires below.
        const lastInputAtMs = s.elapsedMs;
        if (e.kind === "value") {
          const board = new Uint8Array(s.board);
          board[e.index] = e.prevValue;
          const notes = new Uint16Array(e.prevNotes);
          set({
            board,
            notes,
            history: u.next,
            conflicts: findConflicts(board, v),
            isComplete: isComplete(board, v),
            hintSession: null,
            // Lock isComplete back to false if undoing past the win.
            lastInputAtMs,
          });
        } else if (e.kind === "note") {
          const notes = new Uint16Array(s.notes);
          notes[e.index] = e.prevMask;
          set({ notes, history: u.next, hintSession: null, lastInputAtMs });
        } else {
          // notes-bulk: swap the entire notes buffer back. We copy so
          // the stored entry's prevNotes stays immutable for redo.
          set({
            notes: new Uint16Array(e.prevNotes),
            history: u.next,
            hintSession: null,
            lastInputAtMs,
          });
        }
      },

      redo: () => {
        const s = get();
        const v = s.meta?.variant;
        const r = redo(s.history);
        if (!r) return;
        const e = r.entry;
        // RAZ-75: redo is a player action — same treatment as undo.
        const lastInputAtMs = s.elapsedMs;
        if (e.kind === "value") {
          const board = new Uint8Array(s.board);
          board[e.index] = e.nextValue;
          const notes = new Uint16Array(e.nextNotes);
          set({
            board,
            notes,
            history: r.next,
            conflicts: findConflicts(board, v),
            isComplete: isComplete(board, v),
            hintSession: null,
            lastInputAtMs,
          });
        } else if (e.kind === "note") {
          const notes = new Uint16Array(s.notes);
          notes[e.index] = e.nextMask;
          set({ notes, history: r.next, hintSession: null, lastInputAtMs });
        } else {
          // notes-bulk: re-apply the recomputed candidates.
          set({
            notes: new Uint16Array(e.nextNotes),
            history: r.next,
            hintSession: null,
            lastInputAtMs,
          });
        }
      },

      setRemoteHintFetcher: (fn) => {
        remoteHintFetcher = fn;
      },

      hint: async () => {
        const s = get();
        if (s.isComplete || s.isPaused || !s.meta) return;

        // RAZ-14 tier-advance branch. If a progressive session is already
        // in flight, this click bumps it to the next tier instead of
        // starting a new one. Only two intermediate tiers exist (1 and
        // 2); tier 3 is the actual placement which also clears the
        // session so the next click starts fresh.
        if (s.hintSession && s.featureFlags.progressiveHints) {
          if (s.hintSession.tier === 1) {
            // Advance to tier 2 (technique + cell, digit still hidden).
            // No placement yet; no undo entry; no counter bump. The
            // UI layer will read the new session state and emit the
            // tier-2 message toast.
            set({
              hintSession: { ...s.hintSession, tier: 2 },
            });
            return;
          }
          // tier === 2 → place the digit and clear the session. Falls
          // through to the placement code below with `suggestion`
          // already resolved and `incrementCounter: false` because we
          // already bumped `hintsUsed` at tier 1.
          return applyHintPlacement(
            s,
            {
              index: s.hintSession.suggestion.index,
              digit: s.hintSession.suggestion.digit,
              // RAZ-49: forward the technique stashed at tier-1 so
              // the adaptive coach can render a technique-specific
              // follow-up after the placement lands.
              technique: s.hintSession.suggestion.technique,
            },
            { incrementCounter: false, clearSession: true },
            set,
          );
        }

        // No active session: resolve a fresh suggestion. We prefer the
        // local solver path (it can produce a structured HintSuggestion
        // with technique + unit info for the tier-1/tier-2 messages),
        // and fall back to the remote fetcher for daily puzzles whose
        // solutions stay server-side. For remote hits we fabricate a
        // "from-solution"-style suggestion so progressive disclosure
        // still works (tier 1 gets the cell's box; tier 2 shows
        // "Forced placement at r.c.").
        let localHint = nextHint(s.board, {
          selected: s.selection,
          solution: s.meta.solution,
          variant: s.meta.variant,
        });
        if (!localHint && !s.meta.solution && remoteHintFetcher) {
          const boardStr = Array.from(s.board).join("");
          try {
            const remote = await remoteHintFetcher(boardStr, s.selection);
            localHint = {
              index: remote.index,
              digit: remote.digit,
              technique: "from-solution",
              unit: "box",
              // Derive the 0-indexed box from the cell index so the
              // tier-1 "try box N" message aligns with what a human
              // would call it. Same math as solver.boxOf.
              unitIndex:
                Math.floor(Math.floor(remote.index / 9) / 3) * 3 +
                Math.floor((remote.index % 9) / 3),
            };
          } catch {
            return;
          }
        }
        if (!localHint) return;

        // Progressive mode: increment hintsUsed once (this click
        // "spends" the hint), stash the session, and let the UI toast
        // tier 1. Legacy mode: place immediately.
        if (s.featureFlags.progressiveHints) {
          set({
            hintsUsed: s.hintsUsed + 1,
            hintSession: { suggestion: localHint, tier: 1 },
          });
          return;
        }

        return applyHintPlacement(
          s,
          {
            index: localHint.index,
            digit: localHint.digit,
            // RAZ-49: forward the technique so the adaptive coach
            // can render a technique-specific follow-up tip after
            // the placement lands.
            technique: localHint.technique,
          },
          { incrementCounter: true, clearSession: false },
          set,
        );
      },

  togglePause: () =>
    set((s) => ({
      isPaused: !s.isPaused && !s.isComplete ? true : false,
    })),

  // Direct pause setter for programmatic callers (RAZ-21 auto-pause).
  // Mirrors togglePause's invariant that a completed game can never be
  // re-entered into a paused state. No-ops when the current value already
  // matches so we don't trip subscribers with a redundant `set`.
  setPaused: (value: boolean) =>
    set((s) => {
      if (s.isComplete) return s;
      const next = value === true;
      if (s.isPaused === next) return s;
      return { isPaused: next };
    }),

      tick: (ms) => {
        const s = get();
        if (s.isPaused || s.isComplete || !s.meta) return;
        set({ elapsedMs: s.elapsedMs + ms });
      },

      setSetting: (key, value) =>
        set((s) => {
          const nextSettings = { ...s.settings, [key]: value };
          // RAZ-54: when the user manually tweaks a setting that the
          // currently-active preset is opinionated about, drop us into
          // the synthetic "custom" preset id so the picker UI stops
          // claiming that preset is still active. We skip this self-
          // demotion when the change is the `selectedPreset` field
          // itself (so callers can write `setSetting("selectedPreset",
          // "custom")` directly without an infinite loop), and when
          // there's no active named preset to diverge from.
          const active = nextSettings.selectedPreset;
          if (
            key !== "selectedPreset" &&
            active &&
            active !== "custom" &&
            !settingsMatchPreset(nextSettings, active)
          ) {
            nextSettings.selectedPreset = "custom";
          }
          return { settings: nextSettings };
        }),

      applyPreset: (presetId) =>
        set((s) => {
          // "custom" is a sentinel state — applying it doesn't change
          // any individual setting, it just marks the active preset
          // as user-tweaked. The setSetting auto-demote path handles
          // the more common case where a user toggles one setting.
          if (presetId === "custom") {
            return { settings: { ...s.settings, selectedPreset: "custom" } };
          }
          // Unknown id: bail rather than silently corrupting state.
          // Should never happen because the type narrows to PresetId,
          // but a stale persist payload from a future build could
          // smuggle one through.
          if (!PRESET_DEFINITIONS.find((p) => p.id === presetId)) return s;
          const projected = applyPresetToSettings(s.settings, presetId);
          return {
            settings: { ...projected, selectedPreset: presetId },
          };
        }),

      setFeatureFlag: (key, value) =>
        set((s) =>
          s.featureFlags[key] === value
            ? s
            : { featureFlags: { ...s.featureFlags, [key]: value } },
        ),

      getDigitCounts: () => digitCounts(get().board),

      drainEvents: () => {
        const s = get();
        const batch = { events: s.events, seq: s.eventSeq };
        // Reset buffer immediately so any events captured between now
        // and the server round-trip's completion belong to the NEXT
        // flush, not this one. Keeping batches non-overlapping is
        // what makes the seq numbers usable as an ordering key.
        set({ events: [], eventSeq: s.eventSeq + 1 });
        return batch;
      },
    }),
    {
      name: "sudoku-game",
      // Only persist the settings + the active anonymous game. Server-side
      // resume is the source of truth for signed-in users.
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          // SSR no-op storage prevents crashes during prerender.
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return localStorage;
      }),
      partialize: (s) => ({
        settings: s.settings,
        // Persist current game so anonymous users can refresh without
        // losing progress. Typed arrays serialize to plain objects via
        // JSON; we round-trip them through the snapshot format on load.
        snapshot: s.meta
          ? {
              meta: s.meta,
              board: Array.from(s.board).join(""),
              notesB64: encodeNotes(s.notes),
              elapsedMs: s.elapsedMs,
              mistakes: s.mistakes,
              hintsUsed: s.hintsUsed,
              isPaused: s.isPaused,
              isComplete: s.isComplete,
              startedAt: s.startedAt,
              puzzle: s.puzzle,
              // RAZ-81: persist the idempotency token alongside the
              // rest of the snapshot. Critical for the "user reloads
              // the play page after the network ate the first submit"
              // case — without this the rehydrated store would mint a
              // new token and the retry could silently insert a second
              // completed_games row.
              attemptId: s.attemptId,
            }
          : null,
      }),
      // We don't restore typed arrays from the persisted snapshot here;
      // the play page calls `resumeFromSnapshot` explicitly when it
      // detects a stored game. This keeps the rehydration path simple.
      onRehydrateStorage: () => () => {},
    },
  ),
);

// RAZ-73: Expose the store to window in non-production builds so e2e
// tests can drive game state directly without having to type 50+
// digits per test. The expose is gated on NODE_ENV so production
// bundles never carry the reference (which would let any malicious
// extension inspect / mutate the live game).
//
// We reach the store only after at least one client-side render has
// hooked it up — using `setTimeout` here would race the Next hydration
// boundary; instead we attach on the first store subscription. This
// fires once per page load (zustand calls listeners on subscribe) and
// is a no-op everywhere a non-browser env lacks `window`.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  // Cast: typing window with our own augmentation here would leak the
  // dev-only key into all of `lib/`. A localized cast is cleaner.
  (window as unknown as { __sudokuStore?: typeof useGameStore }).__sudokuStore =
    useGameStore;
}

// Read the persisted anonymous snapshot without subscribing to the store.
// Used by the play page to decide whether to offer "Continue".
export function readPersistedSnapshot(): (GameSnapshot & { puzzle: string }) | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("sudoku-game");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { snapshot?: GameSnapshot & { puzzle: string } } };
    return parsed.state?.snapshot ?? null;
  } catch {
    return null;
  }
}

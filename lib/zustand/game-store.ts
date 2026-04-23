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
  },
  hintSession: null,
  events: [],
  eventSeq: 0,
  activeDigit: null,
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
// when the placement creates a conflict. Everything here is best-effort:
// feature-detected (navigator.vibrate only exists on mobile Chrome-ish
// browsers), gated by the feature flag AND the user setting, and
// wrapped in try/catch because some browsers throw if called from an
// un-engaged page (no prior user gesture). Any error is swallowed —
// haptics failing should never break a placement.
function triggerHapticFeedback(isConflict: boolean) {
  if (typeof navigator === "undefined") return;
  // Older iOS Safari and all desktop browsers lack vibrate; feature-
  // detecting keeps the call safe on those. We narrow with a typeof
  // check and then bind the method so TypeScript picks up the right
  // overload (calling via `.call` confuses the union argument type).
  const nav = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return;
  try {
    // Durations tuned for Chrome Android (Pixel and similar). The web
    // Vibration API passes through to VibrationEffect.createOneShot,
    // and most Android haptic motors can't render pulses shorter than
    // ~15-20ms reliably - many reports of 5ms being completely
    // imperceptible on modern Pixels, even though the call returns
    // true. We therefore use:
    //   - 20ms single pulse for a legal placement (subtle tick)
    //   - [40, 60, 40] double pulse for a conflict (clearly longer +
    //     two bumps, distinguishable by feel alone)
    // Both are passed as arrays because a couple of Chromium versions
    // have been flaky with the scalar overload even though the spec
    // allows it.
    const pattern: number[] = isConflict ? [40, 60, 40] : [20];
    nav.vibrate(pattern);
  } catch {
    // Intentionally ignored - see note above.
  }
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
  suggestion: { index: number; digit: number },
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
  set({
    board,
    notes,
    selection: idx,
    hintsUsed: opts.incrementCounter ? s.hintsUsed + 1 : s.hintsUsed,
    hintSession: opts.clearSession ? null : s.hintSession,
    activeDigit,
    history: pushEntry(s.history, entry),
    conflicts: findConflicts(board, v),
    isComplete: isComplete(board, v),
    // RAZ-28: log hint-driven placements under kind "h" so replay /
    // anti-cheat analysis can distinguish them from the player's own
    // placements (e.g. a "perfect run with zero hints" signal relies
    // on being able to filter these out).
    events: maybeRecord(s, "h", idx, suggestion.digit),
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

        // RAZ-19 haptics. Gated by BOTH the server-driven feature flag
        // AND the user's setting so a player can opt out even when the
        // feature is rolled out. Feature-detection for navigator.vibrate
        // happens inside triggerHapticFeedback. Fired before set() so
        // the perceptual "feel" of placing lines up with the visual
        // update (vibrate is async anyway — the UI doesn't wait).
        //
        // `!== false` rather than `=== true` so existing players whose
        // persisted settings blob predates this field (no `haptics`
        // key → value is undefined after rehydrate) get the default-on
        // behavior without needing a persist version migration.
        if (s.featureFlags.haptics && s.settings.haptics !== false) {
          triggerHapticFeedback(isConflict);
        }

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
        });
      },

      undo: () => {
        const s = get();
        const v = s.meta?.variant;
        const u = undo(s.history);
        if (!u) return;
        const e = u.entry;
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
          });
        } else if (e.kind === "note") {
          const notes = new Uint16Array(s.notes);
          notes[e.index] = e.prevMask;
          set({ notes, history: u.next, hintSession: null });
        } else {
          // notes-bulk: swap the entire notes buffer back. We copy so
          // the stored entry's prevNotes stays immutable for redo.
          set({
            notes: new Uint16Array(e.prevNotes),
            history: u.next,
            hintSession: null,
          });
        }
      },

      redo: () => {
        const s = get();
        const v = s.meta?.variant;
        const r = redo(s.history);
        if (!r) return;
        const e = r.entry;
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
          });
        } else if (e.kind === "note") {
          const notes = new Uint16Array(s.notes);
          notes[e.index] = e.nextMask;
          set({ notes, history: r.next, hintSession: null });
        } else {
          // notes-bulk: re-apply the recomputed candidates.
          set({
            notes: new Uint16Array(e.nextNotes),
            history: r.next,
            hintSession: null,
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
          { index: localHint.index, digit: localHint.digit },
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

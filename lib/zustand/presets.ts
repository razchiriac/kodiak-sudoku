// RAZ-54: Mode Presets — a deterministic bundle of per-device settings
// that lets a player switch the entire feel of a session in one tap
// (Learn / Classic / Speed / Zen) instead of clicking through the
// settings dialog. Pure data + a tiny helper; the store imports
// `applyPreset` to project these onto its `settings` slice.
//
// Why a separate module:
//   - The Play home (`app/play/page.tsx` Server Component) needs to
//     render the picker. Pulling the preset map out of game-store keeps
//     the import graph clean — preset.ts has zero React or zustand
//     dependencies, so a Server Component can grab the labels safely.
//   - Tests can exercise the preset projection without booting the
//     entire game store.
//
// Keeping the bundle EXPLICIT (we list every setting we care about
// per preset rather than relying on partial overrides) makes the
// behavior predictable: switching presets always lands the user in
// the exact same configuration, regardless of where they were
// before. A user who wants a one-off tweak can still flip an
// individual toggle in the settings dialog after applying a preset
// — that flips them into the synthetic "custom" preset id.

import type { Palette } from "./game-store";

// Canonical preset identifiers. We use a string-literal union over an
// enum (project rule: maps not enums) so the value round-trips through
// JSON for persistence with no serialization glue. "custom" is a
// special sentinel that means "the user has tweaked at least one
// setting away from the active preset, so we no longer claim a named
// preset is active".
export const PRESETS = ["learn", "classic", "speed", "zen", "custom"] as const;
export type PresetId = (typeof PRESETS)[number];

// The slice of `settings` that a preset is allowed to project onto.
// Lifted out so we can keep the type in lockstep with game-store
// without importing the store (which would create a cycle).
export type PresetSettings = {
  strict: boolean;
  highlightSameDigit: boolean;
  haptics: boolean;
  compactControls: boolean;
  dyslexiaFont: boolean;
  jumpOnPlace: boolean;
  showMistakes: boolean;
  recordEvents: boolean;
  autoNotesEnabled: boolean;
  palette: Palette;
};

// Human-facing metadata for the picker UI. We co-locate label +
// description with the settings bundle so adding a new preset is one
// edit (a single record in PRESET_DEFINITIONS) and there's no risk of
// the label drifting from the bundle it describes.
export type PresetDefinition = {
  id: Exclude<PresetId, "custom">;
  label: string;
  description: string;
  // The explicit settings projection. We list ONLY the keys a preset
  // is opinionated about; other settings (e.g. dyslexiaFont, palette)
  // are accessibility prefs and stay where the user left them across
  // preset switches. Nothing sneaks in by absence.
  settings: Partial<PresetSettings>;
};

// Order matters — picker UIs render in this order. Learn is first
// because it's the recommended on-ramp for new players; Zen is last
// because it's the "no pressure" alternative for casual play.
export const PRESET_DEFINITIONS: readonly PresetDefinition[] = [
  {
    id: "learn",
    label: "Learn",
    description:
      "Forgiving setup for learning techniques. Mistakes turn red, peers stay highlighted, and progressive hints walk you through each deduction.",
    settings: {
      // Wrong values tint red so the player gets immediate feedback
      // on a guess vs. a deduction. Random puzzles only — daily keeps
      // the solution server-side so this gracefully no-ops there.
      showMistakes: true,
      // Peer + same-digit highlights are pure scaffolding for the
      // "where else does this digit fit" pattern recognition step.
      highlightSameDigit: true,
      // Auto-notes wand is on so a learner can fall back to computed
      // candidates when they're stuck.
      autoNotesEnabled: true,
      // No caret jump — learners want to think, not race.
      jumpOnPlace: false,
      // Strict OFF: we WANT the player to commit a wrong placement so
      // they see the red tint and learn from it.
      strict: false,
      compactControls: false,
      haptics: true,
    },
  },
  {
    id: "classic",
    label: "Classic",
    description:
      "The default Sudoku experience. Find your own mistakes, no hand-holding, leaderboard-friendly.",
    settings: {
      // Purist: no real-time mistake tint, no auto-jump, no strict
      // block — exactly the canonical Sudoku rules with no extras.
      showMistakes: false,
      highlightSameDigit: true,
      autoNotesEnabled: true,
      jumpOnPlace: false,
      strict: false,
      compactControls: false,
      haptics: true,
    },
  },
  {
    id: "speed",
    label: "Speed",
    description:
      "Optimized for quick solves: caret jumps to the next empty peer, compact controls give the board more room, no mistake tint.",
    settings: {
      // Caret auto-advance keeps the chain of "where else does 7 go"
      // placements going without a manual click between cells.
      jumpOnPlace: true,
      // Compact pad reclaims vertical room for the board so a speed
      // solver can scan more of it at once on mobile.
      compactControls: true,
      showMistakes: false,
      highlightSameDigit: true,
      autoNotesEnabled: true,
      // No strict block — pausing for "wait, is that legal" kills
      // the flow. Solvers know to glance at the conflicts.
      strict: false,
      haptics: true,
    },
  },
  {
    id: "zen",
    label: "Zen",
    description:
      "Relaxed play. Illegal moves are blocked before they land so the mistake counter never goes up; no caret movement; subtle highlights.",
    settings: {
      // Strict ON makes wrong placements simply not happen — the
      // mistake counter stays at zero. Combined with no real-time
      // mistake tint, the surface is calm: a wrong digit just doesn't
      // appear, no nag, no flash.
      strict: true,
      showMistakes: false,
      highlightSameDigit: true,
      autoNotesEnabled: true,
      jumpOnPlace: false,
      compactControls: false,
      haptics: true,
    },
  },
];

// Lookup helper — returns null for "custom" or for an unknown id so
// callers can branch without a try/catch. We avoid `Map<>` here to
// keep this module trivially serialisable / tree-shakable.
export function getPresetDefinition(
  id: PresetId | null | undefined,
): PresetDefinition | null {
  if (!id || id === "custom") return null;
  return PRESET_DEFINITIONS.find((p) => p.id === id) ?? null;
}

// Apply a preset to a settings object, returning a NEW object with
// the projected keys merged in. Pure function so the store reducer
// can call it with no side effects. Keys not declared in the preset's
// `settings` overrides are passed through unchanged — a player who
// has, say, opted into the dyslexia font does NOT lose that pref when
// they switch presets.
export function applyPresetToSettings<S extends Partial<PresetSettings>>(
  current: S,
  presetId: Exclude<PresetId, "custom">,
): S {
  const def = PRESET_DEFINITIONS.find((p) => p.id === presetId);
  if (!def) return current;
  return { ...current, ...def.settings };
}

// True when `current` settings are byte-for-byte identical to what the
// preset would produce. Used by the store to decide whether a manual
// settings tweak should bump `selectedPreset` to the synthetic
// "custom" id (so the picker stops claiming a named preset is active).
// Only checks keys the preset is opinionated about — a player flipping
// an unrelated toggle (e.g. palette) doesn't bounce them out of their
// preset.
export function settingsMatchPreset(
  current: Partial<PresetSettings>,
  presetId: Exclude<PresetId, "custom">,
): boolean {
  const def = PRESET_DEFINITIONS.find((p) => p.id === presetId);
  if (!def) return false;
  for (const k of Object.keys(def.settings) as (keyof PresetSettings)[]) {
    if (current[k] !== def.settings[k]) return false;
  }
  return true;
}

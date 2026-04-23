import { describe, expect, it } from "vitest";
import {
  PRESET_DEFINITIONS,
  applyPresetToSettings,
  getPresetDefinition,
  settingsMatchPreset,
  type PresetSettings,
} from "./presets";

// Baseline settings that intentionally differ from every preset on
// at least one field so the test can verify a projection actually
// changed something. Mirrors the shape of `GameState["settings"]`'s
// preset-tracked subset.
function baseline(): Partial<PresetSettings> {
  return {
    strict: false,
    highlightSameDigit: true,
    haptics: true,
    compactControls: false,
    dyslexiaFont: false,
    jumpOnPlace: false,
    showMistakes: false,
    recordEvents: false,
    autoNotesEnabled: true,
    palette: "default",
  };
}

describe("presets: PRESET_DEFINITIONS", () => {
  it("includes every advertised preset id in stable order", () => {
    const ids = PRESET_DEFINITIONS.map((p) => p.id);
    expect(ids).toEqual(["learn", "classic", "speed", "zen"]);
  });

  it("each preset has a non-empty label and description", () => {
    for (const p of PRESET_DEFINITIONS) {
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(10);
    }
  });
});

describe("presets: applyPresetToSettings", () => {
  it("Learn preset enables show-mistakes and disables strict", () => {
    const next = applyPresetToSettings(baseline(), "learn");
    expect(next.showMistakes).toBe(true);
    expect(next.strict).toBe(false);
    expect(next.highlightSameDigit).toBe(true);
  });

  it("Speed preset enables jump-on-place and compact controls", () => {
    const next = applyPresetToSettings(baseline(), "speed");
    expect(next.jumpOnPlace).toBe(true);
    expect(next.compactControls).toBe(true);
    expect(next.showMistakes).toBe(false);
  });

  it("Zen preset enables strict mode (illegal placements blocked)", () => {
    const next = applyPresetToSettings(baseline(), "zen");
    expect(next.strict).toBe(true);
    expect(next.showMistakes).toBe(false);
  });

  it("Classic preset is the canonical purist bundle", () => {
    const next = applyPresetToSettings(baseline(), "classic");
    expect(next.showMistakes).toBe(false);
    expect(next.jumpOnPlace).toBe(false);
    expect(next.strict).toBe(false);
  });

  it("preserves accessibility settings the preset doesn't opine on", () => {
    // Baseline has dyslexiaFont:false, palette:"default". We explicitly
    // flip the user into Okabe-Ito + dyslexia ON before applying a
    // preset to prove these survive.
    const start: Partial<PresetSettings> = {
      ...baseline(),
      dyslexiaFont: true,
      palette: "okabe-ito",
    };
    const next = applyPresetToSettings(start, "speed");
    expect(next.dyslexiaFont).toBe(true);
    expect(next.palette).toBe("okabe-ito");
  });
});

describe("presets: settingsMatchPreset", () => {
  it("returns true immediately after applyPresetToSettings", () => {
    for (const def of PRESET_DEFINITIONS) {
      const next = applyPresetToSettings(baseline(), def.id);
      expect(settingsMatchPreset(next, def.id)).toBe(true);
    }
  });

  it("returns false after a single tracked-setting tweak", () => {
    const next = applyPresetToSettings(baseline(), "learn");
    // Learn opines on showMistakes=true; flipping it diverges.
    next.showMistakes = false;
    expect(settingsMatchPreset(next, "learn")).toBe(false);
  });

  it("ignores tweaks to keys the preset doesn't opine on", () => {
    const next = applyPresetToSettings(baseline(), "speed");
    // Speed doesn't opine on dyslexiaFont — so flipping it should
    // NOT count as diverging from the preset.
    next.dyslexiaFont = true;
    expect(settingsMatchPreset(next, "speed")).toBe(true);
  });
});

describe("presets: getPresetDefinition", () => {
  it("returns the matching definition for a known id", () => {
    const def = getPresetDefinition("zen");
    expect(def?.id).toBe("zen");
  });

  it("returns null for null / undefined / 'custom'", () => {
    expect(getPresetDefinition(null)).toBeNull();
    expect(getPresetDefinition(undefined)).toBeNull();
    expect(getPresetDefinition("custom")).toBeNull();
  });
});

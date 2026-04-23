"use client";

import { useEffect } from "react";
import { Brain, Gauge, Leaf, Trophy, Sparkles } from "lucide-react";
import { useGameStore } from "@/lib/zustand/game-store";
import {
  PRESET_DEFINITIONS,
  type PresetId,
} from "@/lib/zustand/presets";
import { cn } from "@/lib/utils";

// RAZ-54: Mode Presets picker. Presented on the play home (`/play`)
// above the difficulty buttons so a player can decide HOW they want
// to play before they pick a difficulty. Also rendered inside the
// settings dialog so a mid-game switch is one click away.
//
// We keep this client-only because the preset state lives in the
// Zustand store (per-device, persisted via localStorage). The Server
// Component on /play forwards the resolved feature flag value as a
// prop so we can mirror it into the store on mount; that way the
// picker hides itself instantly when the flag is flipped off in
// Edge Config without waiting for an effect somewhere else in the
// tree.

// Map preset id → icon. We use `lucide-react` imports rather than an
// emoji per project rules (no emojis unless asked). Each icon was
// chosen for its loose semantic match: Brain = learn, Trophy =
// classic / canonical, Gauge = speed, Leaf = zen.
const PRESET_ICON: Record<
  Exclude<PresetId, "custom">,
  typeof Brain
> = {
  learn: Brain,
  classic: Trophy,
  speed: Gauge,
  zen: Leaf,
};

type ModePresetPickerProps = {
  // Resolved server-side and forwarded by the parent. Mirrored into
  // the store via `setFeatureFlag` so other surfaces (the settings
  // dialog) can read the same source of truth without prop-drilling.
  enabled: boolean;
  // Visual variant. `home` = grid of large cards used on the play
  // home screen. `inline` = compact pill row used inside dialogs.
  variant?: "home" | "inline";
};

export function ModePresetPicker({
  enabled,
  variant = "home",
}: ModePresetPickerProps) {
  const flagOn = useGameStore((s) => s.featureFlags.modePresets);
  const setFeatureFlag = useGameStore((s) => s.setFeatureFlag);
  const selected = useGameStore((s) => s.settings.selectedPreset);
  const applyPreset = useGameStore((s) => s.applyPreset);

  // Mirror the server-resolved flag into the store on mount and on
  // any subsequent change. setFeatureFlag no-ops when unchanged so
  // this is cheap to run on every render.
  useEffect(() => {
    setFeatureFlag("modePresets", enabled);
  }, [enabled, setFeatureFlag]);

  // Render NOTHING when the flag is off. The store mirror still ran
  // above so other components see the same value; we just hide the
  // entry point. Returning null instead of an empty <div> keeps the
  // surrounding flex / grid layouts from getting an extra cell.
  if (!flagOn) return null;

  if (variant === "inline") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">
            Mode preset
          </span>
          {selected === "custom" ? (
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Custom
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESET_DEFINITIONS.map((def) => {
            const Icon = PRESET_ICON[def.id];
            const isActive = selected === def.id;
            return (
              <button
                key={def.id}
                type="button"
                onClick={() => applyPreset(def.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-input bg-background text-muted-foreground hover:bg-accent",
                )}
                aria-pressed={isActive}
                aria-label={`Apply ${def.label} preset`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {def.label}
              </button>
            );
          })}
        </div>
        {selected && selected !== "custom" ? (
          <p className="text-xs text-muted-foreground">
            {PRESET_DEFINITIONS.find((p) => p.id === selected)?.description}
          </p>
        ) : null}
      </div>
    );
  }

  // Default: home variant — a grid of larger cards a player taps
  // before picking a difficulty. Includes the description so the
  // semantics of each preset are obvious without hovering.
  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          How would you like to play?
        </h2>
        {selected === "custom" ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            Custom settings active
          </span>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PRESET_DEFINITIONS.map((def) => {
          const Icon = PRESET_ICON[def.id];
          const isActive = selected === def.id;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => applyPreset(def.id)}
              className={cn(
                "group flex h-full flex-col gap-2 rounded-lg border p-4 text-left transition-colors",
                isActive
                  ? "border-primary bg-primary/5"
                  : "border-input bg-card hover:bg-accent",
              )}
              aria-pressed={isActive}
              aria-label={`Apply ${def.label} mode preset`}
            >
              <div className="flex items-center gap-2">
                <Icon
                  className={cn(
                    "h-5 w-5",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="font-semibold">{def.label}</span>
                {isActive ? (
                  <span className="ml-auto text-xs font-medium text-primary">
                    Active
                  </span>
                ) : null}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {def.description}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

"use client";

import { useGameStore } from "@/lib/zustand/game-store";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Lightweight settings dialog. Today it only hosts the RAZ-19 haptics
// toggle — that keeps the change scoped to its own feature flag — but
// the shape (labeled rows + a checkbox + a hint) is intentionally
// extensible so future settings (e.g. strict mode, colorblind palette)
// can slot in without re-designing the surface.
//
// Each row renders conditionally so a disabled flag genuinely hides
// the UI (no "greyed-out feature" confusion for players).

type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const hapticsFlag = useGameStore((s) => s.featureFlags.haptics);
  // Default-on semantics: see game-store comment on `settings.haptics`.
  // Treating `undefined` (from pre-existing persisted state) as on means
  // a user who already has localStorage from before this release
  // doesn't accidentally get the toggle rendered as off on first paint.
  const hapticsOn = useGameStore((s) => s.settings.haptics !== false);
  const setSetting = useGameStore((s) => s.setSetting);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Per-device preferences.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* RAZ-19 haptics toggle. Rendered only when the server-side
              feature flag is on; anonymous and signed-in users both see
              it because the feature has no DB side effects. */}
          {hapticsFlag && (
            <label className="flex items-start justify-between gap-4 text-sm">
              <span className="flex flex-col">
                <span className="font-medium text-foreground">Haptic feedback</span>
                <span className="text-xs text-muted-foreground">
                  Vibrate on placements. Mobile only — desktop browsers ignore it.
                </span>
              </span>
              <input
                type="checkbox"
                checked={hapticsOn}
                onChange={(e) => setSetting("haptics", e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Haptic feedback"
              />
            </label>
          )}

          {/* Nothing else to configure yet — show a subtle empty state
              so the dialog isn't awkwardly blank if the flag is off.
              Once more settings land, this can be removed. */}
          {!hapticsFlag && (
            <p className="text-sm text-muted-foreground">
              No user-configurable options yet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

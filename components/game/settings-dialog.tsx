"use client";

import { toast } from "sonner";
import { useGameStore } from "@/lib/zustand/game-store";
import { Button } from "@/components/ui/button";
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

// Fire a deliberately-long 200ms pulse from inside a click handler. We
// keep this OUT of the Zustand store on purpose: the Web Vibration API
// requires sticky user activation, and routing the call through a store
// action is one more hop where a buggy Chromium version could decide
// the activation has lapsed. Doing it inline in onClick is the most
// permissive path we have.
//
// Returns a tri-state so the caller can render a specific hint:
//   "unsupported" - no navigator.vibrate on this device
//                   (desktop, Safari, locked-down embeds)
//   "blocked"     - vibrate returned false; browser refused
//                   (usually Chrome site-settings)
//   "fired"       - vibrate returned true; if the user still feels
//                   nothing, the Android system setting is the
//                   likely culprit, NOT the browser
function fireTestPulse(): "unsupported" | "blocked" | "fired" {
  if (typeof navigator === "undefined") return "unsupported";
  const nav = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return "unsupported";
  try {
    const ok = nav.vibrate([200]);
    return ok ? "fired" : "blocked";
  } catch {
    return "blocked";
  }
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const hapticsFlag = useGameStore((s) => s.featureFlags.haptics);
  // Default-on semantics: see game-store comment on `settings.haptics`.
  // Treating `undefined` (from pre-existing persisted state) as on means
  // a user who already has localStorage from before this release
  // doesn't accidentally get the toggle rendered as off on first paint.
  const hapticsOn = useGameStore((s) => s.settings.haptics !== false);
  // RAZ-23: compact controls toggle. Only rendered when the flag is on;
  // defaults to false so existing players see no layout change.
  const compactFlag = useGameStore((s) => s.featureFlags.compactControls);
  const compactOn = useGameStore((s) => s.settings.compactControls === true);
  // RAZ-26: dyslexia-friendly font toggle. Same flag-gated pattern as
  // haptics/compact; the actual font swap is done by the
  // DyslexiaFontLoader effect reading the same store keys.
  const dyslexiaFlag = useGameStore((s) => s.featureFlags.dyslexiaFont);
  const dyslexiaOn = useGameStore((s) => s.settings.dyslexiaFont === true);
  // RAZ-17: jump-on-place toggle. Feature flag gates whether the row is
  // even shown; the actual caret jump in inputDigit also gates on the
  // flag so turning it off in Edge Config reverts to the previous
  // "stay in place" behavior without a persist migration.
  const jumpFlag = useGameStore((s) => s.featureFlags.jumpOnPlace);
  const jumpOn = useGameStore((s) => s.settings.jumpOnPlace === true);
  const setSetting = useGameStore((s) => s.setSetting);

  const handleTestHaptic = () => {
    const result = fireTestPulse();
    if (result === "unsupported") {
      toast("Vibration is not supported on this device.", {
        description: "Desktop and iOS browsers don't expose the Web Vibration API.",
      });
      return;
    }
    if (result === "blocked") {
      toast("The browser blocked the vibration.", {
        description:
          "Chrome → ⋮ → Site settings → Vibration should be set to Allowed.",
      });
      return;
    }
    // Fired successfully. We can't know if the user felt it, so the
    // toast doubles as the "didn't feel anything? try this" hint. The
    // Android Touch feedback setting is by far the most common cause
    // on Pixel devices, so we lead with it.
    toast("Sent a 200 ms pulse.", {
      description:
        "If you didn't feel it, enable Settings → Sound & vibration → Vibration & haptics → Touch feedback.",
    });
  };

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
            <div className="flex flex-col gap-2">
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
              {/* Self-test row. Kept visible even when the toggle is
                  off so a player can verify their device before turning
                  the feature on. onClick calls navigator.vibrate
                  directly so the click's user-activation window is
                  unambiguous — see fireTestPulse() comment above. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestHaptic}
                className="self-start"
              >
                Test vibration
              </Button>
            </div>
          )}

          {/* RAZ-23 compact controls toggle. Same flag-gated pattern
              as haptics: the row only appears when the feature flag
              is on, so if we flip it off in Edge Config the setting
              is hidden (and the number pad falls back to its default
              layout regardless of the persisted user pref). */}
          {compactFlag && (
            <label className="flex items-start justify-between gap-4 text-sm">
              <span className="flex flex-col">
                <span className="font-medium text-foreground">Compact controls</span>
                <span className="text-xs text-muted-foreground">
                  Smaller number pad and buttons. Good for tall phones
                  where the board feels cramped.
                </span>
              </span>
              <input
                type="checkbox"
                checked={compactOn}
                onChange={(e) => setSetting("compactControls", e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Compact controls"
              />
            </label>
          )}

          {/* RAZ-26 dyslexia-friendly font toggle. Flag-gated; the font
              itself is @font-face-registered in globals.css so enabling
              the toggle is instant (the browser downloads the font file
              on first use, not on page load). */}
          {dyslexiaFlag && (
            <label className="flex items-start justify-between gap-4 text-sm">
              <span className="flex flex-col">
                <span className="font-medium text-foreground">
                  Dyslexia-friendly font
                </span>
                <span className="text-xs text-muted-foreground">
                  Swap the UI to OpenDyslexic. Applies everywhere on this
                  device.
                </span>
              </span>
              <input
                type="checkbox"
                checked={dyslexiaOn}
                onChange={(e) => setSetting("dyslexiaFont", e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Dyslexia-friendly font"
              />
            </label>
          )}

          {/* RAZ-17 jump-on-place toggle. When on, placing a value
              moves the selection to the first empty peer (row/col/box)
              so you can chain same-digit placements without mousing
              around. Off by default to keep the default caret behavior
              stable for existing players. */}
          {jumpFlag && (
            <label className="flex items-start justify-between gap-4 text-sm">
              <span className="flex flex-col">
                <span className="font-medium text-foreground">
                  Jump to next empty peer
                </span>
                <span className="text-xs text-muted-foreground">
                  After placing a digit, move the selection to the next
                  empty cell in the same row, column, or box.
                </span>
              </span>
              <input
                type="checkbox"
                checked={jumpOn}
                onChange={(e) => setSetting("jumpOnPlace", e.target.checked)}
                className="mt-1 h-4 w-4 accent-foreground"
                aria-label="Jump to next empty peer after placing a value"
              />
            </label>
          )}

          {/* Empty state shown only when every flag is off. Keeps the
              dialog from looking broken. */}
          {!hapticsFlag && !compactFlag && !dyslexiaFlag && !jumpFlag && (
            <p className="text-sm text-muted-foreground">
              No user-configurable options yet.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

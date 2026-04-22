"use client";

import { useEffect } from "react";
import { useGameStore } from "@/lib/zustand/game-store";

// RAZ-26: client-only side-effect component that keeps the root <html>
// element's `data-font` attribute in sync with two bits of state:
//
//   1. The server-side `dyslexia-font` feature flag (mirrored into the
//      game store's `featureFlags.dyslexiaFont` by the `flagEnabled`
//      prop this component receives).
//   2. The per-user setting `settings.dyslexiaFont` (persisted in
//      localStorage through the zustand `persist` middleware).
//
// The attribute is read by a CSS selector in `globals.css` that swaps
// the UI font-family to OpenDyslexic. We set an attribute rather than
// wrapping children in a context so the change applies to EVERY text
// surface, including portalled ones (toasts, dialogs) that mount
// outside the React tree of their nominal parent.
//
// Rendering `null` on purpose - this component only runs an effect.

type DyslexiaFontLoaderProps = {
  // Server-resolved value of the `dyslexia-font` feature flag. Mirrored
  // into the store so the settings dialog can conditionally render the
  // toggle without a second flag fetch on the client.
  flagEnabled: boolean;
};

export function DyslexiaFontLoader({ flagEnabled }: DyslexiaFontLoaderProps) {
  const setFeatureFlag = useGameStore((s) => s.setFeatureFlag);
  const userSetting = useGameStore((s) => s.settings.dyslexiaFont === true);
  const flagMirror = useGameStore((s) => s.featureFlags.dyslexiaFont);

  // Mirror the server-resolved flag value into the store on mount and
  // whenever it changes (e.g. between page navigations after an Edge
  // Config flip).
  useEffect(() => {
    setFeatureFlag("dyslexiaFont", flagEnabled);
  }, [flagEnabled, setFeatureFlag]);

  // Apply or clear the `data-font` attribute. Gate on BOTH the flag
  // (server) and the user setting so flipping the flag off in Edge
  // Config immediately reverts every client to the default font even
  // if their localStorage still says dyslexiaFont === true.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const active = flagMirror && userSetting;
    if (active) {
      document.documentElement.setAttribute("data-font", "opendyslexic");
    } else {
      document.documentElement.removeAttribute("data-font");
    }
  }, [flagMirror, userSetting]);

  return null;
}

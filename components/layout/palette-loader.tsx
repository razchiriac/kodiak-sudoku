"use client";

import { useEffect } from "react";
import { PALETTES, useGameStore } from "@/lib/zustand/game-store";

// RAZ-25: client-only side-effect component that keeps the root <html>
// element's `data-palette` attribute in sync with:
//
//   1. The server-side `color-palette` feature flag (mirrored into
//      the game store's `featureFlags.colorPalette` by the
//      `flagEnabled` prop passed in).
//   2. The per-user setting `settings.palette` (persisted in
//      localStorage through the zustand `persist` middleware).
//
// The attribute is read by CSS variable overrides in `globals.css`
// that swap the sudoku cell palette only; everything else keeps its
// default chroma. We set an attribute rather than wrapping children
// in a provider so the swap also reaches portalled UI (dialogs,
// toasts) that mount outside the nominal React tree.
//
// Defensive: we accept the persisted value only if it's one of the
// known palette keys. A stale/corrupted localStorage entry (e.g.
// from a future renamed palette) silently falls back to "default"
// instead of writing an unrecognised `data-palette` value that maps
// to no CSS rule and looks broken.
//
// Renders null — pure side-effect component.

type PaletteLoaderProps = {
  // Server-resolved value of the `color-palette` feature flag.
  flagEnabled: boolean;
};

export function PaletteLoader({ flagEnabled }: PaletteLoaderProps) {
  const setFeatureFlag = useGameStore((s) => s.setFeatureFlag);
  const palette = useGameStore((s) => s.settings.palette ?? "default");
  const flagMirror = useGameStore((s) => s.featureFlags.colorPalette);

  // Mirror the server-resolved flag value into the store on mount and
  // whenever it changes across navigations.
  useEffect(() => {
    setFeatureFlag("colorPalette", flagEnabled);
  }, [flagEnabled, setFeatureFlag]);

  // Apply or clear the `data-palette` attribute. Gate on BOTH the
  // flag and the user setting so flipping the flag off in Edge
  // Config reverts every client to the default palette even if they
  // previously opted in.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const safe = (PALETTES as readonly string[]).includes(palette)
      ? palette
      : "default";
    const active = flagMirror && safe !== "default";
    if (active) {
      document.documentElement.setAttribute("data-palette", safe);
    } else {
      document.documentElement.removeAttribute("data-palette");
    }
  }, [flagMirror, palette]);

  return null;
}

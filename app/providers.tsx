"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { DyslexiaFontLoader } from "@/components/layout/dyslexia-font-loader";
import { PaletteLoader } from "@/components/layout/palette-loader";

// Single client component that wires up React Query, theming, and the
// toast portal. Keeps the root layout a clean Server Component.
//
// RAZ-26: we also receive the `dyslexia-font` feature flag value here.
// RAZ-25: ditto for `color-palette`. Both flags are resolved
// server-side in the root layout and forwarded so each loader effect
// mirrors them into the store and toggles the corresponding `<html
// data-*>` attribute when the user opts in.
type ProvidersProps = {
  children: ReactNode;
  dyslexiaFontFlag: boolean;
  colorPaletteFlag: boolean;
};

export function Providers({
  children,
  dyslexiaFontFlag,
  colorPaletteFlag,
}: ProvidersProps) {
  // useState ensures the QueryClient is created once per browser session
  // (not once per render, which would defeat caching).
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        {/* RAZ-26: zero-DOM effect component that syncs the server-
            resolved feature flag with the store and toggles the
            html[data-font] attribute when the user opts in. */}
        <DyslexiaFontLoader flagEnabled={dyslexiaFontFlag} />
        {/* RAZ-25: same pattern — mirrors the server-resolved
            color-palette flag into the store and toggles the
            html[data-palette] attribute based on the persisted
            user choice. */}
        <PaletteLoader flagEnabled={colorPaletteFlag} />
        {children}
        <Toaster position="bottom-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

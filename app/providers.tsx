"use client";

import { useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { DyslexiaFontLoader } from "@/components/layout/dyslexia-font-loader";
import { PaletteLoader } from "@/components/layout/palette-loader";
import { PwaServiceWorker } from "@/components/layout/pwa-service-worker";
import { usePuzzleBankRefresh } from "@/lib/offline/use-puzzle-bank-refresh";

// Single client component that wires up React Query, theming, and the
// toast portal. Keeps the root layout a clean Server Component.
//
// RAZ-26: we also receive the `dyslexia-font` feature flag value here.
// RAZ-25: ditto for `color-palette`. Both flags are resolved
// server-side in the root layout and forwarded so each loader effect
// mirrors them into the store and toggles the corresponding `<html
// data-*>` attribute when the user opts in.
// RAZ-106: ditto for `offline-play`. When on, the puzzle bank refresh
// hook keeps IndexedDB topped up and listens for the SW's
// DRAIN_COMPLETION_QUEUE message to submit offline completions.
type ProvidersProps = {
  children: ReactNode;
  dyslexiaFontFlag: boolean;
  colorPaletteFlag: boolean;
  offlinePlayFlag: boolean;
};

export function Providers({
  children,
  dyslexiaFontFlag,
  colorPaletteFlag,
  offlinePlayFlag,
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

  // RAZ-106: keep the offline puzzle bank topped up and drain queued
  // completions on reconnect.
  usePuzzleBankRefresh(offlinePlayFlag);

  // RAZ-106: listen for the service worker's DRAIN_COMPLETION_QUEUE
  // message (fired by the Background Sync handler) and drain the queue.
  // This handles the case where the device reconnected while no tab was
  // open — the SW fires the sync event on the next page load.
  useEffect(() => {
    if (!offlinePlayFlag) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "DRAIN_COMPLETION_QUEUE") return;
      void import("@/lib/offline/completion-queue").then(({ drainCompletionQueue }) => {
        void drainCompletionQueue();
      });
    };
    navigator.serviceWorker?.addEventListener("message", handler);
    // Also register the Background Sync tag so the SW can fire it.
    navigator.serviceWorker?.ready.then((sw) => {
      // `sync` may not be available on all browsers (e.g. iOS Safari < 16).
      // Cast to any to avoid TS errors on the non-standard SyncManager API.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (sw as any).sync?.register("drain-completions").catch(() => {});
    });
    return () => {
      navigator.serviceWorker?.removeEventListener("message", handler);
    };
  }, [offlinePlayFlag]);

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
        {/* RAZ-85: always register the root service worker so PWA/TWA
            installs get offline navigation fallback + cached shell
            behavior even when the user never opens the push settings. */}
        <PwaServiceWorker />
        {children}
        <Toaster position="bottom-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

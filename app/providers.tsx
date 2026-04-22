"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { DyslexiaFontLoader } from "@/components/layout/dyslexia-font-loader";

// Single client component that wires up React Query, theming, and the
// toast portal. Keeps the root layout a clean Server Component.
//
// RAZ-26: we also receive the `dyslexia-font` feature flag value here.
// The root layout resolves it server-side and forwards it, so the
// DyslexiaFontLoader effect (which mirrors into the zustand store
// and toggles the <html data-font> attribute) can run once on mount.
type ProvidersProps = {
  children: ReactNode;
  dyslexiaFontFlag: boolean;
};

export function Providers({ children, dyslexiaFontFlag }: ProvidersProps) {
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
        {children}
        <Toaster position="bottom-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

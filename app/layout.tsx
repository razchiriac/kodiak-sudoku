import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { Providers } from "./providers";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  title: { default: "Sudoku", template: "%s · Sudoku" },
  description:
    "A fast, keyboard-first Sudoku web app. Daily puzzles, leaderboards, and stats — free to play.",
  applicationName: "Sudoku",
  openGraph: {
    title: "Sudoku",
    description: "The smoothest Sudoku you can play in a browser.",
    type: "website",
  },
};

// Mobile viewport configuration. Without this, mobile Safari can apply
// odd default scaling that makes the board render too small. We also
// set viewportFit: "cover" so we can use safe-area-insets later if
// needed (e.g. on iPhones with a home-indicator bar).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Tints the Android browser/PWA status bar to match the page so
  // there's no jarring strip of contrasting color above the header.
  // We pair light/dark variants so the bar tracks the user's system
  // theme. Note: manifest.ts has a single theme_color used at install
  // time before the page can negotiate its own.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes; the html.class
    // is set client-side to avoid FOUC and that's fine.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <Providers>
          <div className="flex min-h-dvh flex-col">
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
        </Providers>
        <Analytics />
      </body>
    </html>
  );
}

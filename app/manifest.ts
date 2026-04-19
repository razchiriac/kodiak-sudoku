import type { MetadataRoute } from "next";

// Web App Manifest for installable PWA. Next.js auto-serves this at
// /manifest.webmanifest and injects the matching <link> in <head>.
//
// Why dynamic instead of a static JSON: keeps branding in one place
// alongside the rest of the app (theme color etc.) and avoids a
// committed binary asset.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sudoku",
    short_name: "Sudoku",
    description:
      "A fast, keyboard-first Sudoku web app. Daily puzzles, leaderboards, and stats.",
    start_url: "/",
    // standalone hides the browser chrome on Android once installed,
    // so the launched app looks native (no URL bar, no tabs).
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    // theme_color tints the Android status bar. We pick the dark
    // palette here to match the most common in-app rendering and
    // because it photographs better on marketing screenshots; the
    // actual page can override per-system-theme via the viewport
    // themeColor entries in app/layout.tsx.
    theme_color: "#0a0a0a",
    icons: [
      // 192x192 is the minimum Android requires for an installable
      // PWA; 512x512 is used at install-banner and splash time.
      { src: "/icons/192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/512.png", sizes: "512x512", type: "image/png" },
      // Maskable icon = Android's adaptive icon shape (the launcher
      // crops it to a circle/squircle). Needs a 20% safe area.
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    categories: ["games", "puzzle"],
  };
}

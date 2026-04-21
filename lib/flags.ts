import "server-only";
import { flag } from "flags/next";
import { get } from "@vercel/edge-config";

// Central registry for every feature flag in the app. One flag per
// Linear ticket; the ticket ID lives in the description so cleanup is
// easy to find later.
//
// Value resolution order (first match wins):
//   1. Vercel Edge Config, via @vercel/edge-config. Populated from
//      Vercel's Flags dashboard (Create Flag button). This is the
//      production control plane - flip from the UI, no redeploy.
//   2. FLAG_<NAME> env var. Useful for local dev without Edge Config
//      and as a redundant kill-switch if Edge Config is unreachable.
//   3. The flag's `defaultValue`.
//
// Usage from a Server Component or Server Action:
//
//     import { pbRibbon } from "@/lib/flags";
//     const show = await pbRibbon();
//
// For Client Components, evaluate on the server and pass the resolved
// value (or the derived data) as a prop. Don't import this module from
// "use client" files - it's server-only on purpose so the client bundle
// stays lean.

// Resolve a boolean flag with Edge-Config-first, env-var-fallback
// semantics. Extracted so every flag declaration stays a one-liner.
async function resolveBool(edgeKey: string, envKey: string): Promise<boolean> {
  // Only call Edge Config if a connection string is wired up; otherwise
  // the SDK throws on every invocation which is noisy in local dev.
  if (process.env.EDGE_CONFIG) {
    try {
      const val = await get<boolean>(edgeKey);
      if (typeof val === "boolean") return val;
      // Missing key / wrong type: fall through to env var fallback.
    } catch {
      // Edge Config unreachable (network blip, bad connection string).
      // Fall through rather than crashing the page render.
    }
  }
  return process.env[envKey] === "true";
}

// RAZ-22 - Personal-best ribbon in the completion modal.
// When on, the play page fetches the user's previous best time for the
// puzzle's difficulty and the completion modal renders a "New best!"
// ribbon if the current finish beats it.
export const pbRibbon = flag<boolean>({
  key: "pb-ribbon",
  description: "RAZ-22: show personal-best ribbon in completion modal.",
  defaultValue: false,
  options: [
    { value: false, label: "Off" },
    { value: true, label: "On" },
  ],
  decide: () => resolveBool("pb-ribbon", "FLAG_PB_RIBBON"),
});

// RAZ-19 - Haptic feedback on value placements (mobile / PWA polish).
// When on, the game store fires `navigator.vibrate(...)` after each
// value placement - short pulse on a legal move, longer pulse on a
// conflict. The user can still opt out via the in-app settings dialog
// (settings.haptics); the flag controls whether the feature exists at
// all (rendering the settings entry, gating the vibrate call). Safe on
// desktop because the feature is also feature-detected on the client.
export const haptics = flag<boolean>({
  key: "haptics",
  description: "RAZ-19: vibrate on value placements (mobile only).",
  defaultValue: false,
  options: [
    { value: false, label: "Off" },
    { value: true, label: "On" },
  ],
  decide: () => resolveBool("haptics", "FLAG_HAPTICS"),
});

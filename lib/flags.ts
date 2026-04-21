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

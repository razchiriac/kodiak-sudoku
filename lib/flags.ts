import "server-only";
import { flag } from "flags/next";
import { get } from "@vercel/edge-config";
import { FLAG_REGISTRY, type FlagSpec } from "./flag-registry";

// Typed flag declarations for the app. The registry in
// `lib/flag-registry.ts` is the source of truth for keys, env var
// names, default values, and descriptions — this file just wires each
// registry entry to a `flag()` call that resolves against Edge Config
// first, env var second, defaultValue last.
//
// Usage from a Server Component or Server Action:
//
//     import { pbRibbon } from "@/lib/flags";
//     const show = await pbRibbon();
//
// Client Components CANNOT import this module (`server-only` guard).
// Evaluate server-side and forward the resolved boolean as a prop.
// When adding a new flag:
//   1. Add a row to FLAG_REGISTRY.
//   2. Add a named export here via `declareFlag("<key>")`.
//   3. Run `npm run flags:sync` to create the key in Edge Config.

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

// Build a typed flag from a registry row. Each export below calls
// `declareFlag("<key>")` so the compile-time "flag must exist in
// registry" check lives here rather than being repeated.
function declareFlag(key: FlagSpec["key"]) {
  const spec = FLAG_REGISTRY.find((f) => f.key === key);
  if (!spec) {
    // Registry/export mismatch is a developer mistake; crash loudly
    // at import time so it's obvious in CI.
    throw new Error(`Flag "${key}" is not registered in FLAG_REGISTRY`);
  }
  return flag<boolean>({
    key: spec.key,
    description: `${spec.linearId}: ${spec.description}`,
    defaultValue: spec.defaultValue,
    options: [
      { value: false, label: "Off" },
      { value: true, label: "On" },
    ],
    decide: () => resolveBool(spec.key, spec.envKey),
  });
}

// RAZ-22 - Personal-best ribbon in the completion modal.
// When on, the play page fetches the user's previous best time for the
// puzzle's difficulty and the completion modal renders a "New best!"
// ribbon if the current finish beats it.
export const pbRibbon = declareFlag("pb-ribbon");

// RAZ-19 - Haptic feedback on value placements (mobile / PWA polish).
// When on, the game store fires `navigator.vibrate(...)` after each
// value placement - short pulse on a legal move, longer pulse on a
// conflict. The user can still opt out via the in-app settings dialog
// (settings.haptics); the flag controls whether the feature exists at
// all. Feature-detected on the client so desktop is a no-op.
export const haptics = declareFlag("haptics");

// RAZ-27 - Server-side solve-time sanity check.
// When on, `submitCompletionAction` rejects any completion whose client
// `elapsedMs` exceeds `(now - saved_games.started_at) * 1.1 + 2s slack`.
// Defends against a client that inflates its timer (e.g. a buggy clock
// or a trivial spoof of the server action). The 10% + 2s slack absorbs
// normal clock skew between client and server. When a user has no
// saved_games row (unusually fast blitz solve that finished before the
// first autosave), the check is a no-op and the per-difficulty floor
// in TIME_FLOOR_MS still guards the leaderboard.
export const solveTimeSanity = declareFlag("solve-time-sanity");

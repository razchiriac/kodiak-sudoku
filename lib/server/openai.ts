import "server-only";
import OpenAI from "openai";

// RAZ-61 — Thin wrapper around the official `openai` SDK.
//
// Purpose:
//   - Provide a single place where the OpenAI client is constructed
//     so future changes (org id, base URL, custom headers, retry
//     policy) only need to land in one file.
//   - Lazy-initialize: the SDK is only instantiated when something
//     actually needs it. Avoids paying the construction cost (and
//     the env-var read) on routes that don't talk to OpenAI.
//   - Provide a tiny `hasOpenAIKey()` helper so callers can decide
//     whether to short-circuit to a deterministic fallback before
//     constructing a request payload — saves us from racing the
//     dummy-client path purely to hit the same fallback branch.
//
// Why this lives under `lib/server/`:
//   - The `server-only` guard ensures Bundler errors loudly if a
//     client component imports it. The OPENAI_API_KEY MUST never
//     leak into a client bundle.
//
// Why we DON'T export the constructed client at module top-level:
//   - Constructing the SDK touches environment variables. Doing
//     that at import time means dev tooling (lint, vitest setup)
//     would crash if the env var isn't set even when no real call
//     happens. Lazy is safer.
//
// On model selection:
//   - The Linear plan calls for "GPT-5.4 reasoning tier". We default
//     to the model named in OPENAI_MODEL_DEBRIEF (an env var the user
//     sets explicitly per environment) and fall back to a sensible
//     general model name. Keeping the model name in env makes
//     production tier-bumps a config edit, not a code edit.
//   - The DEFAULT model name below is intentionally conservative: a
//     small/cheap model is fine for a 3-bullet generation. Bump to
//     a larger reasoning model in prod via OPENAI_MODEL_DEBRIEF if we
//     decide we want richer prose.

// Cached singleton — module-scoped so all server invocations within
// the same Node process share the underlying HTTP keep-alive pool.
let cachedClient: OpenAI | null = null;

// Returns true when an OPENAI_API_KEY is set in the environment.
// Callers use this to short-circuit to the deterministic fallback
// without constructing a client instance.
export function hasOpenAIKey(): boolean {
  // Trim defensively — Vercel env-var UIs occasionally add a trailing
  // newline that breaks the SDK's auth header.
  const key = process.env.OPENAI_API_KEY?.trim() ?? "";
  return key.length > 0;
}

// Resolve the model identifier used for debrief generations. Defined
// outside `getOpenAI()` so callers can reference the exact same name
// for telemetry / logging without re-implementing the fallback.
export function debriefModel(): string {
  // Project policy (DECISIONS.md): the AI defaults stay on the cheap
  // tier; expensive reasoning models get opted into via env var.
  // `gpt-5.4-mini` is the canonical "small + fast" tier as of 2026-04
  // (same family the project plan calls out, smaller variant).
  const env = process.env.OPENAI_MODEL_DEBRIEF?.trim();
  return env && env.length > 0 ? env : "gpt-5.4-mini";
}

// Lazy singleton accessor. Returns `null` (not throws) when no key is
// configured so callers can branch cleanly:
//
//     const client = getOpenAI();
//     if (!client) return fallback();
//
// Throwing here would force every caller to wrap in try/catch even
// though "no key" is the expected dev / preview state.
export function getOpenAI(): OpenAI | null {
  if (!hasOpenAIKey()) return null;
  if (cachedClient) return cachedClient;
  cachedClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!.trim(),
    // Keep the request timeout strictly tighter than any caller-side
    // timeout so our `Promise.race(..., timeoutMs)` is always the
    // shortest leash. The SDK's default is 10 minutes — way too long
    // for a UI debrief.
    timeout: 10_000,
    // The SDK retries on 429 and 5xx by default. For a UI debrief the
    // user is staring at the modal — we'd rather fall back fast than
    // wait through retries. One retry is a reasonable compromise.
    maxRetries: 1,
  });
  return cachedClient;
}

// Test-only escape hatch: lets the unit tests inject a fake client
// (or reset the singleton between tests) without polluting prod
// import paths. Guarded behind NODE_ENV so a slip-up in app code
// can't accidentally flip the singleton at runtime.
export function __setOpenAIClientForTests(client: OpenAI | null): void {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "__setOpenAIClientForTests is forbidden in production. " +
        "Refactor the caller to inject the client directly instead.",
    );
  }
  cachedClient = client;
}

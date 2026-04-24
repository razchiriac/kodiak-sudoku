"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  DEBRIEF_BUCKET,
  DEBRIEF_LIMITS,
  checkRateLimit,
  rateLimitActorKey,
  recordRateLimitEvent,
} from "@/lib/server/rate-limit";
import { getOpenAI, debriefModel, hasOpenAIKey } from "@/lib/server/openai";
import {
  DebriefInputSchema,
  generateDebrief,
  deterministicDebrief,
  type Debrief,
} from "@/lib/server/debrief";

// RAZ-61 — Server actions for the post-game AI debrief.
//
// Why a co-located actions file (rather than appending to the
// monolithic lib/server/actions.ts):
//   - The AGENTS.md cap is ~200 lines per file. lib/server/actions.ts
//     is already past that and growing; co-locating the new feature
//     keeps the diff scoped and the file count manageable.
//   - The pattern matches Drizzle's "feature folder" style — each
//     feature gets its own .actions.ts as it grows.
//
// What this file does:
//   1. Exposes `generateDebriefAction` — validates input, rate-
//      limits, calls the generator, returns the debrief. NEVER
//      throws across the action boundary; on any failure we still
//      return a deterministic debrief so the UI always renders.
//   2. Exposes `recordDebriefFeedbackAction` — accepts a 👍 / 👎
//      rating from the player. v1 just logs a structured line we
//      can grep in Vercel logs; a follow-up persists into a real
//      table (RAZ-61 v2 / RAZ-58 will probably ship that).

// Output shape returned to the client. Discriminated union so the
// UI gets explicit status branches without optional-chaining noise.
export type DebriefActionResult =
  | {
      ok: true;
      debrief: Debrief;
      // Telemetry-only: tells the UI how the debrief was sourced
      // ("ai" | "deterministic"). UI uses it to label the card
      // honestly (e.g. "AI debrief" vs "Performance summary").
      source: "ai" | "deterministic";
    }
  | { ok: false; error: "schema_invalid" | "rate_limited" | "internal" };

// Rate-limit ceilings exposed so the client can show a helpful
// message ("5 per minute") if it ever trips. Same pattern the hint
// action uses.
export type DebriefRateLimited = Extract<DebriefActionResult, { ok: false; error: "rate_limited" }>;

// Server action. Single entry point for the client component. The
// input schema mirrors DebriefInputSchema; we re-validate here so a
// malformed payload from a tampered client returns a clean error
// rather than crashing the action.
export async function generateDebriefAction(
  raw: unknown,
): Promise<DebriefActionResult> {
  // 1. Validate input. Wrong shape = clean schema_invalid response.
  const parsed = DebriefInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "schema_invalid" };
  }
  const input = parsed.data;

  // 2. Rate-limit. Same actor-key strategy as the hint action so a
  // signed-in player and an anonymous player share consistent
  // accounting. Anonymous players hash by IP; signed-in by user id.
  // Failing to read the user is OK — getCurrentUser() returns null
  // for anonymous, which the actor-key helper handles.
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    user = await getCurrentUser();
  } catch {
    // Treat an auth read failure as anonymous. Worst case the
    // limit applies to that IP for a minute; better than 500ing
    // the whole action.
  }
  const key = await rateLimitActorKey(user?.id ?? null);
  const decision = await checkRateLimit(DEBRIEF_BUCKET, key, DEBRIEF_LIMITS);
  if (!decision.ok) {
    return { ok: false, error: "rate_limited" };
  }

  // 3. Decide whether to even attempt the AI path. If no key is
  // configured, short-circuit to the deterministic fallback —
  // saves us a lazy-singleton roundtrip and keeps the structured
  // log line cleaner.
  let result: Awaited<ReturnType<typeof generateDebrief>>;
  if (!hasOpenAIKey()) {
    result = {
      debrief: deterministicDebrief(input),
      fallbackReason: "no-client",
    };
  } else {
    // 4. Call the generator. The function never throws — every
    // failure mode collapses into a deterministic fallback +
    // structured `fallbackReason`. Wrapped in try/catch anyway
    // because future generator changes might add a throw path.
    try {
      result = await generateDebrief(input, {
        client: getOpenAI(),
        model: debriefModel(),
      });
    } catch {
      // Last-resort safety: any unexpected throw still returns a
      // valid debrief to the client.
      result = {
        debrief: deterministicDebrief(input),
        fallbackReason: "model-error",
      };
    }
  }

  // 5. Charge the actor's quota only on a fully-successful path
  // (i.e. we got at least the deterministic fallback back, which
  // is always — but we keep the call here so a future short-
  // circuit branch can opt out).
  await recordRateLimitEvent(DEBRIEF_BUCKET, key);

  // 6. Structured log line — the only telemetry we have until the
  // proper events table lands. Lets us monitor fallback rate from
  // Vercel logs without exposing details to the UI.
  log("debrief.generated", {
    source: result.debrief.source,
    fallbackReason: result.fallbackReason ?? null,
    difficulty: input.difficultyBucket,
    mode: input.mode,
  });

  return {
    ok: true,
    debrief: result.debrief,
    source: result.debrief.source ?? "deterministic",
  };
}

// 👍 / 👎 feedback. v1 just logs — the UI calls this fire-and-
// forget and doesn't surface failures. We deliberately don't
// rate-limit because a single click per debrief is the
// expected pattern; a flood here is more interesting as a signal
// than as something to block.
const FeedbackSchema = z.object({
  // Stable identifier the client generates per debrief render.
  // Lets us correlate a 👍/👎 with the original generation log
  // line (both share the id). Kept opaque server-side.
  debriefId: z.string().min(1).max(64),
  rating: z.enum(["up", "down"]),
  // The bullets the user actually saw — handy for spot-checking a
  // 👎 in logs without having to recompute. Capped at 3 strings,
  // 120 chars each, matching DebriefSchema.
  bullets: z.array(z.string().max(120)).length(3),
  source: z.enum(["ai", "deterministic"]),
  difficultyBucket: z.number().int().min(1).max(4),
});

export type FeedbackActionResult =
  | { ok: true }
  | { ok: false; error: "schema_invalid" };

export async function recordDebriefFeedbackAction(
  raw: unknown,
): Promise<FeedbackActionResult> {
  const parsed = FeedbackSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "schema_invalid" };
  }
  const { debriefId, rating, source, difficultyBucket } = parsed.data;

  // We DON'T log the bullets directly — they're already in the
  // user's localStorage cache and would just bloat the log lines.
  // The debriefId is enough to correlate.
  log("debrief.feedback", {
    debriefId,
    rating,
    source,
    difficulty: difficultyBucket,
  });

  return { ok: true };
}

// Tiny structured logger. Mirrors the pattern used elsewhere in
// lib/server/actions.ts so all our action telemetry shows up in
// Vercel logs with the same prefix.
function log(event: string, payload: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ event, ...payload }));
  } catch {
    // Defensive — never let a logging failure swallow the action.
  }
}

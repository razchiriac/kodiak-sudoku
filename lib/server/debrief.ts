import type OpenAI from "openai";
import { z } from "zod";
import { computeBreakdown, type RunBreakdown } from "@/lib/sudoku/breakdown";

// RAZ-61 — Pure debrief generation core.
//
// This module is intentionally framework-free:
//   - No `server-only` import (so the unit tests can drive it
//     directly without aliasing).
//   - No DB, no headers(), no React.
//   - The OpenAI client is INJECTED rather than imported, so the
//     tests can mock it with a one-line stub and the production
//     code-path stays the same.
//
// What lives here:
//   1. `DebriefInputSchema` / `DebriefInput` — the sanitized,
//      fully-aggregated payload the caller passes in. The whole
//      point of this layer is "nothing in here exposes the
//      solution, the puzzle, or any per-cell history". That
//      contract is what makes the debrief safe to send to a third-
//      party model.
//   2. `DebriefSchema` / `Debrief` — the strict shape we accept
//      back from the model. Three short bullets + a next-action
//      enum. Anything that doesn't validate is dropped on the
//      floor so a model regression can't surface garbage to the
//      user.
//   3. `buildDebriefPrompt()` — pure text builder. Tested for
//      shape (contains the right metric numbers, never contains
//      the solution shape, etc.).
//   4. `deterministicDebrief()` — a guaranteed-to-render fallback
//      that uses the same `computeBreakdown` numbers the panel
//      already shows. This is what we serve when:
//        a) `OPENAI_API_KEY` isn't set, OR
//        b) the model call fails / times out, OR
//        c) the model returns invalid data.
//   5. `generateDebrief()` — the orchestrator. Either returns a
//      validated AI debrief OR the deterministic fallback. NEVER
//      returns `null`; the caller doesn't need a no-result branch.
//
// On the 3-second p95 budget (acceptance criterion):
//   - We Promise.race the model call against `timeoutMs` (default
//     2_500). The 500ms headroom is for the network round trip
//     between the player's browser and our server.
//   - On timeout we return the deterministic fallback so the UI
//     always renders something within budget.

// Sanitized input: the caller MUST pass only aggregate numbers
// (matching the BreakdownInput shape used by computeBreakdown). No
// puzzle, no solution, no event log. The `mode` field is a tiny
// hint so the model knows whether the player just finished a
// daily, a quick drill, or a custom puzzle (changes the next-action
// recommendation flavor a bit).
//
// `previousBestMs` is optional — we only forward it when the
// player is signed in and has a prior best in the same bucket.
// `personalBestImproved` is a derived bool the caller computes;
// keeping it as a bool (rather than recomputing on the model side)
// removes one off-by-one foot-gun.
export const DebriefInputSchema = z.object({
  elapsedMs: z.number().int().nonnegative(),
  mistakes: z.number().int().nonnegative(),
  hintsUsed: z.number().int().nonnegative(),
  difficultyBucket: z.number().int().min(1).max(4),
  mode: z.enum(["daily", "random", "custom", "challenge", "quick"]),
  // Optional comparison data. Caller passes null when irrelevant
  // (anonymous player, no prior solve in this bucket, daily-no-
  // previous-best).
  previousBestMs: z.number().int().nonnegative().nullable().optional(),
  personalBestImproved: z.boolean().optional(),
});

export type DebriefInput = z.infer<typeof DebriefInputSchema>;

// What the model is required to return. Keep the schema tight:
//   - bullets: exactly 3 short strings, each ≤120 chars.
//   - tone: a fixed enum so the UI can color-code consistently.
//   - nextActionId: a fixed enum so the CTA button always has a
//     known route to send the player to.
//
// `source` is set by `generateDebrief()` itself, NOT by the model.
// It tells the UI whether the bullets came from OpenAI or the
// deterministic fallback so the UI can adjust copy ("debrief by
// AI" vs "performance summary").
const BULLET_MAX_CHARS = 120;

export const DebriefSchema = z.object({
  bullets: z
    .array(z.string().min(1).max(BULLET_MAX_CHARS))
    .length(3, { message: "Debrief must contain exactly 3 bullets." }),
  tone: z.enum(["congratulatory", "encouraging", "constructive"]),
  nextActionId: z.enum([
    "play-same-difficulty",
    "play-harder",
    "play-easier",
    "try-zen-mode",
    "try-speed-mode",
    "study-techniques",
    "back-to-hub",
  ]),
  // Short label for the next-action button. Authored by the model;
  // capped so it always fits on a button.
  nextActionLabel: z.string().min(1).max(40),
  source: z.enum(["ai", "deterministic"]).optional(),
});

export type Debrief = z.infer<typeof DebriefSchema>;

// Pure prompt builder. Returns the user-message body we hand to
// OpenAI. Kept separate from the call site so the unit tests can
// pin down its shape without spinning up a model.
//
// Design notes:
//   - We send the deterministic breakdown OUTPUT (pace bucket,
//     accuracy bucket, recommendation id) rather than just the raw
//     numbers. Reason: the model is much more reliable when it can
//     anchor its bullets to a categorized signal ("the player was
//     SLOW + ROUGH") than when it has to bucket the numbers itself
//     and then reason from the buckets. We also send the raw
//     numbers so it can quote them in a bullet without inventing.
//   - We instruct it to NOT invent stats. Combined with the schema
//     this is belt-and-braces; the schema rejects invented bullets
//     by length/shape, the instruction discourages them at source.
//   - The system message + JSON-schema constraint is set on the
//     SDK call (see `generateDebrief`). This builder only produces
//     the user-message body so we can swap providers later without
//     touching the prompt-construction logic.
export function buildDebriefPrompt(
  input: DebriefInput,
  breakdown: RunBreakdown,
): string {
  const elapsedSec = Math.round(input.elapsedMs / 1000);
  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;
  const elapsedHuman =
    minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  const difficultyName = (
    [null, "Easy", "Medium", "Hard", "Expert"] as const
  )[input.difficultyBucket] ?? "Medium";

  // Optional PB context. Only render the line when the caller
  // forwarded a previous best — keeps the prompt clean for first-
  // time solvers.
  const pbLine =
    typeof input.previousBestMs === "number"
      ? `previous_best_seconds: ${Math.round(input.previousBestMs / 1000)}\n` +
        `improved_personal_best: ${input.personalBestImproved ? "yes" : "no"}\n`
      : "";

  // The body is a small YAML-ish key/value block — much easier for
  // GPT-class models to anchor on than free prose. We label every
  // number so a future-tense bullet can quote it back verbatim.
  return [
    "Player just finished a Sudoku run. Generate a SHORT, factual,",
    "personal debrief.",
    "",
    "RUN STATS (do not invent any other stats):",
    `mode: ${input.mode}`,
    `difficulty: ${difficultyName} (bucket ${input.difficultyBucket})`,
    `elapsed: ${elapsedHuman} (${elapsedSec} seconds)`,
    `mistakes: ${input.mistakes}`,
    `hints_used: ${input.hintsUsed}`,
    pbLine,
    "DETERMINISTIC ASSESSMENT (already shown to the player):",
    `pace_bucket: ${breakdown.pace.kind} (${breakdown.pace.pctOfTarget}% of target time)`,
    `accuracy_bucket: ${breakdown.accuracy.kind}`,
    `assistance_bucket: ${breakdown.assistance.kind}`,
    `system_recommendation: ${breakdown.recommendation.id}`,
    "",
    "WRITE EXACTLY 3 BULLETS (each ≤120 chars):",
    "  1. one specific thing the player did well, anchored to a stat above.",
    "  2. one specific thing to improve next time, anchored to a stat above.",
    "  3. one concrete next action; this MUST match nextActionId you choose.",
    "",
    "Pick a `tone`:",
    "  - congratulatory: player's run was clean + fast + unassisted.",
    "  - encouraging: player completed but had a couple bumps (minor mistakes / a hint).",
    "  - constructive: player struggled (rough accuracy or heavy hint use).",
    "",
    "Pick a `nextActionId` from the enum. Match it to the system_recommendation",
    "above when sensible. Provide a short button label (≤40 chars).",
    "",
    "RULES:",
    "- Address the player as 'you'. Sentence case, no exclamation pile-ups.",
    "- Do NOT mention any number that isn't in RUN STATS above.",
    "- Do NOT mention specific cells, digits, rows, columns, or boxes.",
    "- Do NOT speculate about move history beyond the buckets given.",
  ].join("\n");
}

// JSON schema we hand to the SDK so the model returns the shape we
// expect natively. Kept inline rather than re-derived from the Zod
// schema because OpenAI's JSON-schema dialect doesn't 1:1 map to
// Zod. Manual is clearer.
//
// Exported so the unit tests can confirm we ship the right shape.
export const DEBRIEF_RESPONSE_JSON_SCHEMA = {
  name: "Debrief",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["bullets", "tone", "nextActionId", "nextActionLabel"],
    properties: {
      bullets: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: { type: "string", minLength: 1, maxLength: BULLET_MAX_CHARS },
      },
      tone: {
        type: "string",
        enum: ["congratulatory", "encouraging", "constructive"],
      },
      nextActionId: {
        type: "string",
        enum: [
          "play-same-difficulty",
          "play-harder",
          "play-easier",
          "try-zen-mode",
          "try-speed-mode",
          "study-techniques",
          "back-to-hub",
        ],
      },
      nextActionLabel: { type: "string", minLength: 1, maxLength: 40 },
    },
  },
} as const;

// Deterministic fallback. NEVER throws on real input — the
// `computeBreakdown` call inside is itself purely defensive. The
// shape mirrors the AI debrief exactly so the UI doesn't need a
// branch. We tag `source: "deterministic"` so the UI can label the
// card honestly.
export function deterministicDebrief(input: DebriefInput): Debrief {
  const breakdown = computeBreakdown({
    elapsedMs: input.elapsedMs,
    mistakes: input.mistakes,
    hintsUsed: input.hintsUsed,
    difficultyBucket: input.difficultyBucket,
  });

  // Pick a tone from the bucket triple — same logic the AI prompt
  // suggests, just baked into code so there's no model in the path.
  const tone: Debrief["tone"] =
    breakdown.accuracy.kind === "clean" &&
    breakdown.pace.kind === "fast" &&
    breakdown.assistance.kind === "unassisted"
      ? "congratulatory"
      : breakdown.accuracy.kind === "rough" || breakdown.assistance.kind === "heavy"
        ? "constructive"
        : "encouraging";

  // Map the deterministic recommendation id to a UI-side action +
  // label. This is the same routing the AI is supposed to perform;
  // having it in code as a fallback is what makes the no-key path
  // useful.
  const action = recommendationToAction(breakdown.recommendation.id);

  // Three bullets composed from the breakdown labels. Stable copy —
  // the unit tests pin a few canonical fixtures so future tweaks
  // are intentional.
  const bullets: [string, string, string] = [
    breakdown.pace.label,
    breakdown.accuracy.label,
    breakdown.assistance.label,
  ];

  return {
    bullets,
    tone,
    nextActionId: action.id,
    nextActionLabel: action.label,
    source: "deterministic",
  };
}

// Small lookup so both the deterministic fallback AND the UI's
// next-action click handler can agree on what each id maps to.
// Exported because the UI consumes it.
export type NextActionId = Debrief["nextActionId"];

export function recommendationToAction(
  id: RunBreakdown["recommendation"]["id"],
): { id: NextActionId; label: string } {
  switch (id) {
    case "step-up-difficulty":
      return { id: "play-harder", label: "Try a harder puzzle" };
    case "try-speed-mode":
      return { id: "try-speed-mode", label: "Try Speed mode" };
    case "try-zen-mode":
      return { id: "try-zen-mode", label: "Try Zen mode" };
    case "slow-down-for-accuracy":
      return { id: "play-easier", label: "Try an easier puzzle" };
    case "study-techniques":
      return { id: "study-techniques", label: "Open Technique Journey" };
    case "keep-practicing":
      return { id: "play-same-difficulty", label: "Play another" };
    default:
      return { id: "back-to-hub", label: "Back to play hub" };
  }
}

// Orchestrator. Always returns a Debrief — the deterministic
// fallback is built in. Caller signature is deliberately small so
// the server action can hand it the parsed input + an optional
// pre-built client (handy in tests).
//
// On model errors we silently fall back; the action emits a
// structured log line so we can monitor failure rate without
// leaking the error to the user (acceptance: "Invalid or unverified
// model outputs never surface to users.").
export type GenerateDebriefOptions = {
  client?: OpenAI | null;
  model?: string;
  // Hard timeout for the model call. Default keeps us well under
  // the 3s p95 acceptance criterion even with a slow network leg.
  timeoutMs?: number;
  // Test hook: lets the unit suite force the no-key branch without
  // mutating process.env.
  forceFallback?: boolean;
};

export type GenerateDebriefResult = {
  debrief: Debrief;
  // Useful for telemetry. UI doesn't read this.
  fallbackReason?:
    | "no-client"
    | "force-fallback"
    | "timeout"
    | "model-error"
    | "schema-invalid";
};

export async function generateDebrief(
  rawInput: DebriefInput,
  opts: GenerateDebriefOptions = {},
): Promise<GenerateDebriefResult> {
  // Re-validate input even though the caller is supposed to have
  // done so. Defense in depth — keeps this function a clean entry
  // point that's safe to call from anywhere.
  const input = DebriefInputSchema.parse(rawInput);

  if (opts.forceFallback) {
    return { debrief: deterministicDebrief(input), fallbackReason: "force-fallback" };
  }

  const client = opts.client ?? null;
  if (!client) {
    return { debrief: deterministicDebrief(input), fallbackReason: "no-client" };
  }

  const breakdown = computeBreakdown({
    elapsedMs: input.elapsedMs,
    mistakes: input.mistakes,
    hintsUsed: input.hintsUsed,
    difficultyBucket: input.difficultyBucket,
  });
  const userPrompt = buildDebriefPrompt(input, breakdown);
  const model = opts.model ?? "gpt-5.4-mini";
  const timeoutMs = opts.timeoutMs ?? 2_500;

  // Race the model against an explicit timeout. We deliberately do
  // NOT race against the SDK's own timeout because a network blip
  // can stretch the SDK well past our 3s budget; the explicit race
  // guarantees the UI gets SOMETHING within budget.
  const modelPromise = callModel(client, model, userPrompt);
  const timeoutPromise = new Promise<"__timeout__">((resolve) => {
    setTimeout(() => resolve("__timeout__"), timeoutMs);
  });

  let modelResponse: Awaited<ReturnType<typeof callModel>> | "__timeout__";
  try {
    modelResponse = await Promise.race([modelPromise, timeoutPromise]);
  } catch {
    return { debrief: deterministicDebrief(input), fallbackReason: "model-error" };
  }

  if (modelResponse === "__timeout__") {
    return { debrief: deterministicDebrief(input), fallbackReason: "timeout" };
  }

  if (!modelResponse.ok) {
    return { debrief: deterministicDebrief(input), fallbackReason: "model-error" };
  }

  const parsed = DebriefSchema.safeParse(modelResponse.json);
  if (!parsed.success) {
    return { debrief: deterministicDebrief(input), fallbackReason: "schema-invalid" };
  }

  return { debrief: { ...parsed.data, source: "ai" } };
}

// Internal: makes the actual SDK call. Kept private so we can swap
// providers later without touching the orchestrator.
//
// Returns either {ok:true, json} or {ok:false} so the caller never
// has to wrap this in try/catch — every failure mode normalizes
// into the same shape.
type CallModelResult = { ok: true; json: unknown } | { ok: false };

async function callModel(
  client: OpenAI,
  model: string,
  userPrompt: string,
): Promise<CallModelResult> {
  try {
    // Using the chat completions API with response_format
    // json_schema so structured outputs come back natively. The
    // SDK validates the shape against our schema before resolving;
    // we still re-validate with Zod for paranoia (model bugs,
    // schema drift, etc.).
    const completion = await client.chat.completions.create({
      model,
      // Low temperature: we want the model to anchor on the
      // numbers we passed in, not get creative with them.
      temperature: 0.4,
      // Cap output to keep cost predictable. Three short bullets +
      // a label fit comfortably in 200 tokens.
      max_tokens: 220,
      response_format: {
        type: "json_schema",
        json_schema: DEBRIEF_RESPONSE_JSON_SCHEMA,
      },
      messages: [
        {
          role: "system",
          content:
            "You are a concise Sudoku coach. You write factual, encouraging post-game debriefs. " +
            "You NEVER invent statistics, NEVER reveal puzzle solutions, and NEVER give cell-level " +
            "advice. You always reply with valid JSON that matches the provided schema.",
        },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return { ok: false };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false };
    }
    return { ok: true, json };
  } catch {
    return { ok: false };
  }
}

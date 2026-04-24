import { describe, it, expect } from "vitest";
import {
  buildDebriefPrompt,
  deterministicDebrief,
  generateDebrief,
  recommendationToAction,
  DebriefInputSchema,
  DebriefSchema,
  DEBRIEF_RESPONSE_JSON_SCHEMA,
  type DebriefInput,
} from "./debrief";
import { computeBreakdown } from "@/lib/sudoku/breakdown";

// RAZ-61 — Unit tests for the debrief generation engine.
//
// We focus on three things:
//   1. The PROMPT BUILDER produces the right shape and never leaks
//      info we don't want sent to the model (no solution, no per-
//      cell history). Pin the structure with a few snapshot-style
//      contains-checks that future edits will visibly change.
//   2. The DETERMINISTIC FALLBACK produces a Debrief that passes
//      its own schema for representative fixtures.
//   3. The ORCHESTRATOR returns the deterministic fallback when
//      no client is provided, when forceFallback is set, when the
//      mocked client throws, and when the mocked client returns
//      bad JSON. The orchestrator NEVER throws — every failure
//      mode collapses to a structured result.

// Small helper: a clean "expert in 3:30, no mistakes, no hints"
// fixture. Used as the starting point for most tests.
function expertCleanInput(overrides: Partial<DebriefInput> = {}): DebriefInput {
  return {
    elapsedMs: 3 * 60 * 1000 + 30 * 1000,
    mistakes: 0,
    hintsUsed: 0,
    difficultyBucket: 4,
    mode: "random",
    ...overrides,
  };
}

describe("DebriefInputSchema", () => {
  it("accepts a well-formed input", () => {
    const out = DebriefInputSchema.safeParse(expertCleanInput());
    expect(out.success).toBe(true);
  });

  it("rejects negative numbers", () => {
    const out = DebriefInputSchema.safeParse({
      ...expertCleanInput(),
      mistakes: -1,
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown modes", () => {
    // safeParse takes `unknown`, so an invalid string here doesn't
    // trigger a TS error — the schema is the runtime guard. Cast
    // through `unknown` to keep the test honest about that.
    const out = DebriefInputSchema.safeParse({
      ...expertCleanInput(),
      mode: "tutorial" as unknown as never,
    });
    expect(out.success).toBe(false);
  });

  it("rejects difficulty bucket out of range", () => {
    const out = DebriefInputSchema.safeParse({
      ...expertCleanInput(),
      difficultyBucket: 5,
    });
    expect(out.success).toBe(false);
  });

  it("accepts optional previous-best fields when present", () => {
    const out = DebriefInputSchema.safeParse(
      expertCleanInput({
        previousBestMs: 4 * 60 * 1000,
        personalBestImproved: true,
      }),
    );
    expect(out.success).toBe(true);
  });

  it("accepts null previousBestMs", () => {
    const out = DebriefInputSchema.safeParse(
      expertCleanInput({ previousBestMs: null }),
    );
    expect(out.success).toBe(true);
  });
});

describe("DebriefSchema", () => {
  it("accepts a well-formed AI debrief", () => {
    const out = DebriefSchema.safeParse({
      bullets: [
        "Clean expert solve in 3m 30s — strong pace.",
        "You stayed under target with zero mistakes.",
        "Level up: try a custom-paced challenge next.",
      ],
      tone: "congratulatory",
      nextActionId: "play-harder",
      nextActionLabel: "Play another expert",
    });
    expect(out.success).toBe(true);
  });

  it("rejects when bullets are not exactly 3", () => {
    const out = DebriefSchema.safeParse({
      bullets: ["one", "two"],
      tone: "encouraging",
      nextActionId: "play-same-difficulty",
      nextActionLabel: "Play another",
    });
    expect(out.success).toBe(false);
  });

  it("rejects bullets longer than 120 chars", () => {
    const tooLong = "x".repeat(121);
    const out = DebriefSchema.safeParse({
      bullets: [tooLong, "fine", "fine"],
      tone: "encouraging",
      nextActionId: "play-same-difficulty",
      nextActionLabel: "Play another",
    });
    expect(out.success).toBe(false);
  });

  it("rejects unknown next-action ids", () => {
    const out = DebriefSchema.safeParse({
      bullets: ["a", "b", "c"],
      tone: "encouraging",
      nextActionId: "open-leaderboard",
      nextActionLabel: "Leaderboard",
    });
    expect(out.success).toBe(false);
  });

  it("rejects empty bullets", () => {
    const out = DebriefSchema.safeParse({
      bullets: ["", "ok", "ok"],
      tone: "encouraging",
      nextActionId: "play-same-difficulty",
      nextActionLabel: "Go",
    });
    expect(out.success).toBe(false);
  });
});

describe("buildDebriefPrompt", () => {
  it("includes the run stats block with sanitized aggregates", () => {
    const input = expertCleanInput();
    const breakdown = computeBreakdown(input);
    const prompt = buildDebriefPrompt(input, breakdown);

    // Spot-check that key numbers we passed in actually land in
    // the prompt. We do contains-checks rather than full equality
    // so cosmetic copy edits don't churn the test.
    expect(prompt).toContain("RUN STATS");
    expect(prompt).toContain("difficulty: Expert");
    expect(prompt).toContain("mistakes: 0");
    expect(prompt).toContain("hints_used: 0");
    expect(prompt).toContain("mode: random");
    expect(prompt).toContain("210 seconds");
  });

  it("includes the deterministic-assessment block", () => {
    const input = expertCleanInput();
    const breakdown = computeBreakdown(input);
    const prompt = buildDebriefPrompt(input, breakdown);

    expect(prompt).toContain("DETERMINISTIC ASSESSMENT");
    expect(prompt).toContain("pace_bucket:");
    expect(prompt).toContain("accuracy_bucket: clean");
    expect(prompt).toContain("assistance_bucket: unassisted");
  });

  it("forbids inventing stats and revealing the solution", () => {
    const prompt = buildDebriefPrompt(
      expertCleanInput(),
      computeBreakdown(expertCleanInput()),
    );
    // The "do not mention any number that isn't in RUN STATS" rule
    // is the load-bearing guardrail; we want to know if it ever
    // gets accidentally deleted.
    expect(prompt.toLowerCase()).toContain("do not mention any number");
    expect(prompt.toLowerCase()).toContain("do not mention specific cells");
  });

  it("conditionally includes previous-best info when present", () => {
    const withPb = buildDebriefPrompt(
      expertCleanInput({
        previousBestMs: 5 * 60 * 1000,
        personalBestImproved: true,
      }),
      computeBreakdown(expertCleanInput()),
    );
    expect(withPb).toContain("previous_best_seconds: 300");
    expect(withPb).toContain("improved_personal_best: yes");

    const withoutPb = buildDebriefPrompt(
      expertCleanInput(),
      computeBreakdown(expertCleanInput()),
    );
    expect(withoutPb).not.toContain("previous_best_seconds");
    expect(withoutPb).not.toContain("improved_personal_best");
  });
});

describe("deterministicDebrief", () => {
  it("returns a Debrief that validates against the schema", () => {
    const out = deterministicDebrief(expertCleanInput());
    const parsed = DebriefSchema.safeParse(out);
    expect(parsed.success).toBe(true);
    expect(out.source).toBe("deterministic");
  });

  it("picks 'congratulatory' tone for a clean fast unassisted solve", () => {
    // Easy bucket, very fast, no mistakes, no hints — the textbook
    // "step-up-difficulty" recommendation, congratulatory tone.
    const out = deterministicDebrief({
      elapsedMs: 60 * 1000,
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 1,
      mode: "random",
    });
    expect(out.tone).toBe("congratulatory");
    expect(out.nextActionId).toBe("play-harder");
  });

  it("picks 'constructive' tone when accuracy is rough", () => {
    const out = deterministicDebrief({
      elapsedMs: 8 * 60 * 1000,
      mistakes: 7,
      hintsUsed: 0,
      difficultyBucket: 2,
      mode: "random",
    });
    expect(out.tone).toBe("constructive");
    // Rough accuracy → slow down → easier puzzle next.
    expect(out.nextActionId).toBe("play-easier");
  });

  it("picks 'constructive' tone when assistance is heavy", () => {
    const out = deterministicDebrief({
      elapsedMs: 8 * 60 * 1000,
      mistakes: 0,
      hintsUsed: 8,
      difficultyBucket: 2,
      mode: "random",
    });
    expect(out.tone).toBe("constructive");
    // Heavy assistance → study techniques.
    expect(out.nextActionId).toBe("study-techniques");
  });

  it("picks 'encouraging' tone for a typical solve with a couple bumps", () => {
    const out = deterministicDebrief({
      elapsedMs: 8 * 60 * 1000,
      mistakes: 1,
      hintsUsed: 1,
      difficultyBucket: 2,
      mode: "daily",
    });
    expect(out.tone).toBe("encouraging");
  });

  it("produces 3 bullets with stable copy from the breakdown labels", () => {
    const out = deterministicDebrief(expertCleanInput());
    expect(out.bullets).toHaveLength(3);
    // Each bullet should be the corresponding breakdown label, so
    // a future tweak to those labels surfaces here.
    expect(out.bullets[0].toLowerCase()).toContain("pace");
    expect(out.bullets[1].toLowerCase()).toMatch(/clean|mistake/);
    expect(out.bullets[2].toLowerCase()).toMatch(/hint|assist/);
  });
});

describe("recommendationToAction", () => {
  it("maps every recommendation id to a known next-action id", () => {
    const ids = [
      "step-up-difficulty",
      "try-speed-mode",
      "try-zen-mode",
      "slow-down-for-accuracy",
      "study-techniques",
      "keep-practicing",
    ] as const;
    for (const id of ids) {
      const action = recommendationToAction(id);
      const parsed = DebriefSchema.shape.nextActionId.safeParse(action.id);
      expect(parsed.success).toBe(true);
      expect(action.label.length).toBeGreaterThan(0);
      expect(action.label.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("DEBRIEF_RESPONSE_JSON_SCHEMA", () => {
  it("declares strict mode + the right required fields", () => {
    expect(DEBRIEF_RESPONSE_JSON_SCHEMA.strict).toBe(true);
    expect(DEBRIEF_RESPONSE_JSON_SCHEMA.schema.required).toEqual([
      "bullets",
      "tone",
      "nextActionId",
      "nextActionLabel",
    ]);
    expect(DEBRIEF_RESPONSE_JSON_SCHEMA.schema.additionalProperties).toBe(false);
  });

  it("matches the next-action enum used by the runtime schema", () => {
    const schemaEnum = DEBRIEF_RESPONSE_JSON_SCHEMA.schema.properties.nextActionId.enum;
    // DebriefSchema.shape.nextActionId is a ZodEnum — its .options
    // are the canonical ids. The two MUST stay in sync; this test
    // catches the day someone bumps one and forgets the other.
    const runtimeEnum = DebriefSchema.shape.nextActionId.options;
    expect(new Set(schemaEnum)).toEqual(new Set(runtimeEnum));
  });
});

describe("generateDebrief — orchestrator fallbacks", () => {
  it("returns the deterministic fallback when no client is given", async () => {
    const out = await generateDebrief(expertCleanInput());
    expect(out.debrief.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("no-client");
  });

  it("returns the deterministic fallback when forceFallback is true", async () => {
    const out = await generateDebrief(expertCleanInput(), {
      forceFallback: true,
      // Even with a client present, forceFallback wins. Pass a
      // fake client to ensure we never call into it.
      client: {} as never,
    });
    expect(out.debrief.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("force-fallback");
  });

  it("falls back to deterministic when the model call throws", async () => {
    // Minimal stub of the OpenAI client — only the bits the
    // generator uses. Forces the chat.completions.create promise
    // to reject so we exercise the catch branch in callModel.
    const client = {
      chat: {
        completions: {
          create: () => Promise.reject(new Error("network down")),
        },
      },
    } as never;
    const out = await generateDebrief(expertCleanInput(), { client });
    expect(out.debrief.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("model-error");
  });

  it("falls back to deterministic when the model returns malformed JSON", async () => {
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [{ message: { content: "not even close to JSON" } }],
            }),
        },
      },
    } as never;
    const out = await generateDebrief(expertCleanInput(), { client });
    expect(out.debrief.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("model-error");
  });

  it("falls back to deterministic when JSON is valid but schema is wrong", async () => {
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      bullets: ["only one"],
                      tone: "encouraging",
                      nextActionId: "play-same-difficulty",
                      nextActionLabel: "Play",
                    }),
                  },
                },
              ],
            }),
        },
      },
    } as never;
    const out = await generateDebrief(expertCleanInput(), { client });
    expect(out.debrief.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("schema-invalid");
  });

  it("falls back to deterministic when the model takes longer than timeoutMs", async () => {
    // Stub that resolves AFTER our caller-side timeout. The
    // orchestrator should give up and serve the fallback rather
    // than wait for the slow promise.
    const client = {
      chat: {
        completions: {
          create: () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            bullets: ["a", "b", "c"],
                            tone: "encouraging",
                            nextActionId: "play-same-difficulty",
                            nextActionLabel: "Play",
                          }),
                        },
                      },
                    ],
                  }),
                500,
              ),
            ),
        },
      },
    } as never;
    const out = await generateDebrief(expertCleanInput(), {
      client,
      timeoutMs: 50,
    });
    expect(out.debrief.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("timeout");
  });

  it("returns the AI debrief verbatim when the model behaves", async () => {
    const aiResponse = {
      bullets: [
        "You finished an Expert in 3m 30s — fast for the bucket.",
        "Zero mistakes is the textbook clean-solve marker.",
        "Step up: try a daily Expert next to lock it in.",
      ],
      tone: "congratulatory" as const,
      nextActionId: "play-harder" as const,
      nextActionLabel: "Try a harder one",
    };
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(aiResponse) } }],
            }),
        },
      },
    } as never;
    const out = await generateDebrief(expertCleanInput(), { client });
    expect(out.fallbackReason).toBeUndefined();
    expect(out.debrief.source).toBe("ai");
    expect(out.debrief.bullets).toEqual(aiResponse.bullets);
    expect(out.debrief.tone).toBe("congratulatory");
    expect(out.debrief.nextActionId).toBe("play-harder");
  });
});

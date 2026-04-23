import { describe, expect, it } from "vitest";
import { computeBreakdown } from "./breakdown";

// RAZ-45: deterministic breakdown engine. Tests pin down each rule's
// trigger conditions so a future refactor of the recommendation
// ordering can't silently change which fixture maps to which id.

describe("computeBreakdown: pace bucketing", () => {
  it("buckets a sub-70% target solve as 'fast'", () => {
    const b = computeBreakdown({
      elapsedMs: 3 * 60 * 1000, // Easy target = 5min, this is 60%
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 1,
    });
    expect(b.pace.kind).toBe("fast");
    expect(b.pace.pctOfTarget).toBe(60);
    expect(b.pace.label).toMatch(/Fast pace/);
  });

  it("buckets within ±30% of target as 'typical'", () => {
    const b = computeBreakdown({
      elapsedMs: 9 * 60 * 1000, // Medium target = 9min, on target
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 2,
    });
    expect(b.pace.kind).toBe("typical");
    expect(b.pace.pctOfTarget).toBe(100);
  });

  it("buckets a 130%+ solve as 'slow'", () => {
    const b = computeBreakdown({
      elapsedMs: 30 * 60 * 1000, // Medium target = 9min, this is 333%
      mistakes: 1,
      hintsUsed: 0,
      difficultyBucket: 2,
    });
    expect(b.pace.kind).toBe("slow");
    expect(b.pace.pctOfTarget).toBeGreaterThan(130);
  });

  it("falls back to the Medium target for an unknown bucket", () => {
    const b = computeBreakdown({
      elapsedMs: 9 * 60 * 1000,
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 99, // not in TARGET_TIME_MS
    });
    expect(b.pace.pctOfTarget).toBe(100); // 9min / 9min target
  });
});

describe("computeBreakdown: accuracy + assistance bucketing", () => {
  it("zero mistakes is 'clean'", () => {
    const b = computeBreakdown({
      elapsedMs: 5 * 60 * 1000,
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 1,
    });
    expect(b.accuracy.kind).toBe("clean");
  });

  it("1-2 mistakes is 'minor'", () => {
    const b = computeBreakdown({
      elapsedMs: 5 * 60 * 1000,
      mistakes: 2,
      hintsUsed: 0,
      difficultyBucket: 1,
    });
    expect(b.accuracy.kind).toBe("minor");
  });

  it("3+ mistakes is 'rough'", () => {
    const b = computeBreakdown({
      elapsedMs: 5 * 60 * 1000,
      mistakes: 5,
      hintsUsed: 0,
      difficultyBucket: 1,
    });
    expect(b.accuracy.kind).toBe("rough");
  });

  it("3+ hints is 'heavy' assistance", () => {
    const b = computeBreakdown({
      elapsedMs: 5 * 60 * 1000,
      mistakes: 0,
      hintsUsed: 4,
      difficultyBucket: 1,
    });
    expect(b.assistance.kind).toBe("heavy");
  });
});

describe("computeBreakdown: recommendation rules", () => {
  it("rough accuracy → slow-down-for-accuracy", () => {
    const b = computeBreakdown({
      elapsedMs: 4 * 60 * 1000,
      mistakes: 6,
      hintsUsed: 0,
      difficultyBucket: 1,
    });
    expect(b.recommendation.id).toBe("slow-down-for-accuracy");
  });

  it("heavy hint use beats step-up even when fast & clean", () => {
    // Clean + fast normally suggests step-up, but heavy hint use
    // means the player isn't truly clean. Hints rule fires first.
    const b = computeBreakdown({
      elapsedMs: 2 * 60 * 1000,
      mistakes: 0,
      hintsUsed: 5,
      difficultyBucket: 1,
    });
    expect(b.recommendation.id).toBe("study-techniques");
  });

  it("clean + fast + unassisted on Easy/Medium/Hard → step-up", () => {
    const b = computeBreakdown({
      elapsedMs: 3 * 60 * 1000,
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 2,
    });
    expect(b.recommendation.id).toBe("step-up-difficulty");
  });

  it("clean + fast on Expert → does NOT recommend step-up (no higher bucket)", () => {
    const b = computeBreakdown({
      elapsedMs: 12 * 60 * 1000, // 48% of Expert target
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 4,
    });
    expect(b.recommendation.id).not.toBe("step-up-difficulty");
  });

  it("typical pace, light or no assist → try-speed-mode", () => {
    const b = computeBreakdown({
      elapsedMs: 9 * 60 * 1000, // typical Medium
      mistakes: 1,
      hintsUsed: 1,
      difficultyBucket: 2,
    });
    expect(b.recommendation.id).toBe("try-speed-mode");
  });

  it("slow pace + minor mistakes → try-zen-mode", () => {
    const b = computeBreakdown({
      elapsedMs: 30 * 60 * 1000,
      mistakes: 2,
      hintsUsed: 1,
      difficultyBucket: 2,
    });
    expect(b.recommendation.id).toBe("try-zen-mode");
  });

  it("falls through to keep-practicing when nothing else matches", () => {
    // Slow + clean + no hints — none of the other rules trigger.
    const b = computeBreakdown({
      elapsedMs: 30 * 60 * 1000,
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 2,
    });
    expect(b.recommendation.id).toBe("keep-practicing");
  });
});

describe("computeBreakdown: shape contract", () => {
  it("always returns a fully populated breakdown object", () => {
    const b = computeBreakdown({
      elapsedMs: 1,
      mistakes: 0,
      hintsUsed: 0,
      difficultyBucket: 1,
    });
    expect(b.pace.label.length).toBeGreaterThan(0);
    expect(b.accuracy.label.length).toBeGreaterThan(0);
    expect(b.assistance.label.length).toBeGreaterThan(0);
    expect(b.recommendation.title.length).toBeGreaterThan(0);
    expect(b.recommendation.body.length).toBeGreaterThan(0);
  });
});

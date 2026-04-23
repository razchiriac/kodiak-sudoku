import { describe, expect, it } from "vitest";
import {
  ACHIEVEMENTS_BY_KEY,
  ACHIEVEMENT_DEFS,
  computeEarnedKeys,
  type AchievementFacts,
} from "./achievements-defs";

// RAZ-10 — unit tests for achievement predicates.
// These use synthesized facts so the tests are decoupled from DB.

function baseFacts(overrides: Partial<AchievementFacts> = {}): AchievementFacts {
  return {
    totalSolves: 0,
    hasExpertSolve: false,
    hasDailySolve: false,
    fastestEasyMs: null,
    currentDailyStreak: 0,
    longestDailyStreak: 0,
    ...overrides,
  };
}

describe("computeEarnedKeys", () => {
  it("returns nothing for a brand-new player", () => {
    expect(computeEarnedKeys(baseFacts())).toEqual([]);
  });

  it("earns first-solve at 1", () => {
    expect(computeEarnedKeys(baseFacts({ totalSolves: 1 }))).toEqual([
      "first-solve",
    ]);
  });

  it("earns cumulative solve milestones", () => {
    expect(computeEarnedKeys(baseFacts({ totalSolves: 10 }))).toContain("solve-10");
    expect(
      computeEarnedKeys(baseFacts({ totalSolves: 100 })),
    ).toEqual(
      expect.arrayContaining(["first-solve", "solve-10", "solve-100"]),
    );
    const big = computeEarnedKeys(baseFacts({ totalSolves: 1000 }));
    expect(big).toEqual(
      expect.arrayContaining(["first-solve", "solve-10", "solve-100", "solve-1000"]),
    );
  });

  it("earns first-expert only when an Expert solve exists", () => {
    expect(
      computeEarnedKeys(baseFacts({ totalSolves: 1, hasExpertSolve: true })),
    ).toContain("first-expert");
    expect(
      computeEarnedKeys(baseFacts({ totalSolves: 500, hasExpertSolve: false })),
    ).not.toContain("first-expert");
  });

  it("earns first-daily when mode=daily is present", () => {
    expect(
      computeEarnedKeys(baseFacts({ hasDailySolve: true })),
    ).toContain("first-daily");
  });

  it("earns sub5-easy when fastest Easy is under 5 minutes", () => {
    expect(
      computeEarnedKeys(baseFacts({ fastestEasyMs: 4 * 60 * 1000 })),
    ).toContain("sub5-easy");
    // Exactly 5min is NOT under 5min — strict inequality matters
    // so the badge feels earned, not gifted.
    expect(
      computeEarnedKeys(baseFacts({ fastestEasyMs: 5 * 60 * 1000 })),
    ).not.toContain("sub5-easy");
    expect(
      computeEarnedKeys(baseFacts({ fastestEasyMs: null })),
    ).not.toContain("sub5-easy");
  });

  it("earns streak badges from longestDailyStreak, not current", () => {
    // A player whose streak just broke at 9 should still have the
    // 7-day badge, because it reflects a real past achievement.
    const broken = baseFacts({
      currentDailyStreak: 0,
      longestDailyStreak: 9,
    });
    expect(computeEarnedKeys(broken)).toContain("streak-7");
    expect(computeEarnedKeys(broken)).not.toContain("streak-30");
  });

  it("earns streak-30 at exactly 30", () => {
    expect(
      computeEarnedKeys(baseFacts({ longestDailyStreak: 30 })),
    ).toContain("streak-30");
  });
});

describe("ACHIEVEMENTS_BY_KEY", () => {
  it("contains every definition indexed by key", () => {
    expect(Object.keys(ACHIEVEMENTS_BY_KEY).length).toBe(
      ACHIEVEMENT_DEFS.length,
    );
    for (const def of ACHIEVEMENT_DEFS) {
      expect(ACHIEVEMENTS_BY_KEY[def.key]).toBe(def);
    }
  });

  it("keys are unique", () => {
    const keys = ACHIEVEMENT_DEFS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

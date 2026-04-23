import { describe, expect, it } from "vitest";
import { tier1Message, tier2Message } from "./hint-tier";
import type { HintSuggestion } from "./solver";

// RAZ-14 — Unit tests for the tier-message formatters. Kept cheap on
// purpose: the formatters are pure and their contract is strictly
// about the exact string shown to the player, so snapshot-style
// equality is the right granularity.

function make(overrides: Partial<HintSuggestion>): HintSuggestion {
  return {
    index: 20,
    digit: 5,
    technique: "naked-single",
    unit: "box",
    unitIndex: 0,
    ...overrides,
  };
}

describe("tier1Message", () => {
  it("describes a row with 1-indexed labeling", () => {
    expect(
      tier1Message(make({ unit: "row", unitIndex: 2 })),
    ).toBe("Try looking at row 3.");
  });

  it("describes a column", () => {
    expect(
      tier1Message(make({ unit: "col", unitIndex: 6 })),
    ).toBe("Try looking at column 7.");
  });

  it("describes a box", () => {
    expect(tier1Message(make({ unit: "box", unitIndex: 4 }))).toBe(
      "Try looking at box 5.",
    );
  });
});

describe("tier2Message", () => {
  it("formats r{r}c{c} using 1-indexed coordinates", () => {
    // index 20 → r=2, c=2 zero-indexed → "r3c3" one-indexed
    expect(tier2Message(make({ index: 20 }))).toBe("Naked single at r3c3.");
  });

  it("labels hidden singles explicitly", () => {
    expect(
      tier2Message(
        make({ index: 0, technique: "hidden-single", unit: "row", unitIndex: 0 }),
      ),
    ).toBe("Hidden single at r1c1.");
  });

  it("uses a neutral label for from-solution so we don't misrepresent the technique", () => {
    expect(
      tier2Message(make({ index: 80, technique: "from-solution" })),
    ).toBe("Forced placement at r9c9.");
  });
});

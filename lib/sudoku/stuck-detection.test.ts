import { describe, expect, it } from "vitest";
import { detectStuck, RESCUE_WARMUP_MS } from "./stuck-detection";
import type { InputEvent } from "./input-events";

// RAZ-48: Stuck Detection unit tests.
//
// The detectors are pure functions of (events, conflicts, elapsed)
// so the tests are exhaustive across each detector's threshold AND
// the priority order between them.

// Tiny constructor helper — keeps fixtures readable and lets every
// test focus on the field that triggers (or suppresses) a detector.
function makeInput(overrides: Partial<Parameters<typeof detectStuck>[0]> = {}) {
  return {
    events: [] as InputEvent[],
    conflictCount: 0,
    elapsedMs: 5 * 60 * 1000,
    conflictSinceMs: null,
    isRunning: true,
    isComplete: false,
    ...overrides,
  };
}

function placeEvent(c: number, t: number, kind: "v" | "e" = "v"): InputEvent {
  return { c, d: kind === "v" ? 5 : 0, t, k: kind };
}

describe("detectStuck: gating", () => {
  it("returns null when paused", () => {
    expect(detectStuck(makeInput({ isRunning: false }))).toBeNull();
  });

  it("returns null when complete", () => {
    expect(detectStuck(makeInput({ isComplete: true }))).toBeNull();
  });

  it("respects warmup window", () => {
    expect(
      detectStuck(makeInput({ elapsedMs: RESCUE_WARMUP_MS - 1 })),
    ).toBeNull();
  });
});

describe("detectStuck: idle detector", () => {
  it("fires after 90s of no events from elapsedMs anchor", () => {
    const sig = detectStuck(makeInput({ elapsedMs: 91_000, events: [] }));
    expect(sig?.kind).toBe("idle");
    expect(sig?.reason).toMatch(/since your last move/);
  });

  it("does NOT fire when last event was recent", () => {
    const sig = detectStuck(
      makeInput({
        elapsedMs: 100_000,
        events: [placeEvent(0, 50_000)],
      }),
    );
    expect(sig).toBeNull();
  });

  it("uses last event timestamp, not wall clock, for the gap", () => {
    const sig = detectStuck(
      makeInput({
        elapsedMs: 200_000,
        events: [placeEvent(0, 100_000)],
      }),
    );
    expect(sig?.kind).toBe("idle");
  });
});

describe("detectStuck: repeat detector", () => {
  it("fires on 4+ same-cell oscillations within window", () => {
    const events: InputEvent[] = [
      placeEvent(40, 30_000, "v"),
      placeEvent(40, 32_000, "e"),
      placeEvent(40, 34_000, "v"),
      placeEvent(40, 36_000, "e"),
    ];
    const sig = detectStuck(makeInput({ elapsedMs: 40_000, events }));
    expect(sig?.kind).toBe("repeat");
    expect(sig?.reason).toMatch(/4 times/);
  });

  it("ignores hint-driven placements", () => {
    const events: InputEvent[] = [
      { c: 40, d: 5, t: 30_000, k: "h" },
      { c: 40, d: 0, t: 32_000, k: "h" },
      { c: 40, d: 5, t: 34_000, k: "h" },
      { c: 40, d: 0, t: 36_000, k: "h" },
    ];
    const sig = detectStuck(makeInput({ elapsedMs: 40_000, events }));
    // Hint events are ignored by the repeat filter, AND the most-recent
    // event timestamp is t=36s vs elapsed=40s (only 4s gap), so neither
    // repeat nor idle qualify. Result is null.
    expect(sig).toBeNull();
  });

  it("does NOT fire when the same cell has fewer than 4 hits", () => {
    const events: InputEvent[] = [
      placeEvent(40, 30_000, "v"),
      placeEvent(40, 32_000, "e"),
      placeEvent(40, 34_000, "v"),
    ];
    const sig = detectStuck(makeInput({ elapsedMs: 40_000, events }));
    expect(sig?.kind).not.toBe("repeat");
  });
});

describe("detectStuck: conflict detector", () => {
  it("fires when a conflict has persisted for 30s+", () => {
    const sig = detectStuck(
      makeInput({
        elapsedMs: 60_000,
        conflictCount: 1,
        conflictSinceMs: 25_000,
      }),
    );
    expect(sig?.kind).toBe("conflict");
    expect(sig?.reason).toMatch(/conflict/);
  });

  it("does NOT fire when conflict is fresh", () => {
    const sig = detectStuck(
      makeInput({
        elapsedMs: 60_000,
        conflictCount: 1,
        conflictSinceMs: 50_000,
      }),
    );
    expect(sig?.kind).not.toBe("conflict");
  });

  it("does NOT fire when conflictSinceMs is unknown", () => {
    const sig = detectStuck(
      makeInput({
        elapsedMs: 60_000,
        conflictCount: 1,
        conflictSinceMs: null,
      }),
    );
    expect(sig?.kind).not.toBe("conflict");
  });
});

describe("detectStuck: priority ordering", () => {
  it("conflict beats repeat when both qualify", () => {
    const events: InputEvent[] = [
      placeEvent(40, 30_000, "v"),
      placeEvent(40, 32_000, "e"),
      placeEvent(40, 34_000, "v"),
      placeEvent(40, 36_000, "e"),
    ];
    const sig = detectStuck(
      makeInput({
        elapsedMs: 70_000,
        events,
        conflictCount: 2,
        conflictSinceMs: 35_000,
      }),
    );
    expect(sig?.kind).toBe("conflict");
  });

  it("repeat beats idle when both qualify", () => {
    // Simulate a player who oscillated once then went idle for 90s.
    const events: InputEvent[] = [
      placeEvent(40, 60_000, "v"),
      placeEvent(40, 62_000, "e"),
      placeEvent(40, 64_000, "v"),
      placeEvent(40, 66_000, "e"),
    ];
    const sig = detectStuck(makeInput({ elapsedMs: 160_000, events }));
    // 160s elapsed - 66s last = 94s gap → idle qualifies AND repeat
    // qualifies (4 hits in window). Repeat should win per ordering.
    expect(sig?.kind).toBe("repeat");
  });
});

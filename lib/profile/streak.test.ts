import { describe, expect, it } from "vitest";
import { computePlayingStreak } from "./streak";

describe("computePlayingStreak", () => {
  it("returns 0/0 when there are no completion dates", () => {
    expect(computePlayingStreak([], "2026-04-29")).toEqual({
      current: 0,
      longest: 0,
    });
  });

  it("counts consecutive-day run ending today as the current streak", () => {
    expect(
      computePlayingStreak(
        ["2026-04-27", "2026-04-28", "2026-04-29"],
        "2026-04-29",
      ),
    ).toEqual({ current: 3, longest: 3 });
  });

  it("counts a run that ended yesterday (still alive)", () => {
    // Player solved Mon/Tue/Wed but hasn't played Thu yet — the run
    // is still considered active until tomorrow.
    expect(
      computePlayingStreak(
        ["2026-04-27", "2026-04-28"],
        "2026-04-29",
      ),
    ).toEqual({ current: 2, longest: 2 });
  });

  it("returns current 0 when latest play is older than yesterday", () => {
    // Latest play 5 days ago — streak is broken.
    expect(
      computePlayingStreak(
        ["2026-04-20", "2026-04-21", "2026-04-22"],
        "2026-04-29",
      ),
    ).toEqual({ current: 0, longest: 3 });
  });

  it("dedupes multiple completions on the same day", () => {
    // 3 completions on day 1, 1 each on day 2 and 3 → still a 3-day
    // streak, not a 5-day one.
    expect(
      computePlayingStreak(
        [
          "2026-04-27",
          "2026-04-27",
          "2026-04-27",
          "2026-04-28",
          "2026-04-29",
        ],
        "2026-04-29",
      ),
    ).toEqual({ current: 3, longest: 3 });
  });

  it("computes longest across multiple gaps", () => {
    // Two runs: 4-day (Apr 1..4) and 2-day (Apr 10..11). Latest is
    // Apr 11 which is more than 1 day before "today" (Apr 29) so
    // current = 0 and longest = 4.
    expect(
      computePlayingStreak(
        [
          "2026-04-01",
          "2026-04-02",
          "2026-04-03",
          "2026-04-04",
          "2026-04-10",
          "2026-04-11",
        ],
        "2026-04-29",
      ),
    ).toEqual({ current: 0, longest: 4 });
  });

  it("handles a run that crosses a month boundary", () => {
    expect(
      computePlayingStreak(
        ["2026-03-30", "2026-03-31", "2026-04-01"],
        "2026-04-01",
      ),
    ).toEqual({ current: 3, longest: 3 });
  });

  it("treats unsorted input the same as sorted input", () => {
    expect(
      computePlayingStreak(
        ["2026-04-29", "2026-04-27", "2026-04-28"],
        "2026-04-29",
      ),
    ).toEqual({ current: 3, longest: 3 });
  });
});

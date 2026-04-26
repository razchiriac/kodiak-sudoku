import { describe, it, expect } from "vitest";
import {
  buildShareBlock,
  buildShareText,
  buildShareUrl,
} from "./format";

// Pinned base URL so assertions stay stable regardless of the env.
const BASE = "https://sudoku.app";

describe("buildShareText", () => {
  it("formats a daily result with zero-pluralisations", () => {
    const text = buildShareText({
      mode: "daily",
      difficultyBucket: 3,
      elapsedMs: 3 * 60_000 + 12_000,
      mistakes: 0,
      hintsUsed: 0,
      dailyDate: "2026-04-19",
    });
    expect(text).toBe(
      "Sudoku Daily solved · Hard · 2026-04-19\n⏱ 03:12 · 🎯 0 mistakes · 💡 0 hints\nCan you beat this daily run?",
    );
  });

  it("singularises 1 mistake / 1 hint correctly", () => {
    const text = buildShareText({
      mode: "random",
      difficultyBucket: 2,
      elapsedMs: 5 * 60_000 + 41_000,
      mistakes: 1,
      hintsUsed: 1,
    });
    expect(text).toBe(
      "Sudoku solved · Medium\n⏱ 05:41 · 🎯 1 mistake · 💡 1 hint\nCan you beat my time?",
    );
  });

  it("falls back to 'Sudoku' when difficulty bucket is unknown", () => {
    const text = buildShareText({
      mode: "random",
      difficultyBucket: 99,
      elapsedMs: 1000,
      mistakes: 0,
      hintsUsed: 0,
    });
    expect(text.startsWith("Sudoku solved · Sudoku")).toBe(true);
  });
});

describe("buildShareUrl", () => {
  it("links to /daily when sharing today's daily", () => {
    const url = buildShareUrl(
      {
        mode: "daily",
        difficultyBucket: 3,
        elapsedMs: 10_000,
        mistakes: 0,
        hintsUsed: 0,
        dailyDate: "2026-04-19",
        today: "2026-04-19",
      },
      { baseUrl: BASE },
    );
    expect(url.startsWith(`${BASE}/daily?`)).toBe(true);
    expect(url).toContain("shared=1");
    expect(url).toContain("t=10000");
    expect(url).toContain("d=3");
    expect(url).toContain("mode=daily");
    expect(url).toContain("date=2026-04-19");
    expect(url).toContain("utm_source=sudoku_app");
    expect(url).toContain("utm_medium=share");
    expect(url).toContain("utm_campaign=completion_share");
    expect(url).toContain("utm_content=daily_result");
  });

  it("links to /daily/<date> for archive shares", () => {
    const url = buildShareUrl(
      {
        mode: "daily",
        difficultyBucket: 2,
        elapsedMs: 1000,
        mistakes: 0,
        hintsUsed: 0,
        dailyDate: "2026-04-10",
        today: "2026-04-19",
      },
      { baseUrl: BASE },
    );
    expect(url.startsWith(`${BASE}/daily/2026-04-10?`)).toBe(true);
  });

  it("links to /play/<id> for random shares", () => {
    const url = buildShareUrl(
      {
        mode: "random",
        difficultyBucket: 4,
        elapsedMs: 99_000,
        mistakes: 2,
        hintsUsed: 0,
        puzzleId: 42,
      },
      { baseUrl: BASE },
    );
    expect(url.startsWith(`${BASE}/play/42?`)).toBe(true);
    expect(url).toContain("m=2");
    expect(url).toContain("utm_content=random_result");
  });

  it("throws when puzzleId is missing for random mode", () => {
    expect(() =>
      buildShareUrl(
        {
          mode: "random",
          difficultyBucket: 1,
          elapsedMs: 100,
          mistakes: 0,
          hintsUsed: 0,
        },
        { baseUrl: BASE },
      ),
    ).toThrow(/puzzleId required/);
  });

  it("throws when dailyDate is missing for daily mode", () => {
    expect(() =>
      buildShareUrl(
        {
          mode: "daily",
          difficultyBucket: 1,
          elapsedMs: 100,
          mistakes: 0,
          hintsUsed: 0,
        },
        { baseUrl: BASE },
      ),
    ).toThrow(/dailyDate required/);
  });

  it("strips trailing slash from baseUrl", () => {
    const url = buildShareUrl(
      {
        mode: "random",
        difficultyBucket: 1,
        elapsedMs: 1,
        mistakes: 0,
        hintsUsed: 0,
        puzzleId: 1,
      },
      { baseUrl: `${BASE}/` },
    );
    expect(url.startsWith(`${BASE}/play/1?`)).toBe(true);
  });
});

describe("buildShareBlock", () => {
  it("joins text and url with a blank line", () => {
    const block = buildShareBlock(
      {
        mode: "random",
        difficultyBucket: 1,
        elapsedMs: 60_000,
        mistakes: 0,
        hintsUsed: 0,
        puzzleId: 7,
      },
      { baseUrl: BASE },
    );
    const parts = block.split("\n\n");
    expect(parts).toHaveLength(2);
    expect(parts[0]).toContain("Sudoku solved · Easy");
    expect(parts[1]).toContain(`${BASE}/play/7?`);
  });
});

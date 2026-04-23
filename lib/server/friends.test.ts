import { describe, it, expect } from "vitest";
import { canonicalPair } from "./friends-pair";

// RAZ-12 — canonicalPair is the foundational invariant for the
// friendships table. Every write goes through it; if it ever
// returns a non-canonical ordering the PK / check constraint
// bites us at insert time, not here. So we test the contract
// thoroughly even though the function is three lines long.

describe("canonicalPair", () => {
  it("returns { userA: a, userB: b } when a < b", () => {
    expect(canonicalPair("aaa", "zzz")).toEqual({ userA: "aaa", userB: "zzz" });
  });

  it("swaps when a > b so userA is always the smaller id", () => {
    expect(canonicalPair("zzz", "aaa")).toEqual({ userA: "aaa", userB: "zzz" });
  });

  it("is symmetric: swap(a,b) === swap(b,a)", () => {
    const p1 = canonicalPair("uuid-1", "uuid-2");
    const p2 = canonicalPair("uuid-2", "uuid-1");
    expect(p1).toEqual(p2);
  });

  it("handles realistic UUID-like strings", () => {
    const a = "3f7c5a90-0000-0000-0000-000000000001";
    const b = "3f7c5a90-0000-0000-0000-000000000002";
    const { userA, userB } = canonicalPair(b, a);
    expect(userA).toBe(a);
    expect(userB).toBe(b);
  });

  it("preserves equal ids (edge case; caller shouldn't actually hit this)", () => {
    expect(canonicalPair("x", "x")).toEqual({ userA: "x", userB: "x" });
  });
});

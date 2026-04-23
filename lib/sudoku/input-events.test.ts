import { describe, expect, it } from "vitest";
import { EVENT_BUFFER_CAP, appendEvent, type InputEvent } from "./input-events";

// RAZ-28 — ring-buffer semantics. The store depends on the FIFO
// eviction so we pin it with a test that would fail loudly if someone
// ever "optimized" the cap by dropping the slice() copy.

function ev(i: number): InputEvent {
  return { c: i % 81, d: 1, t: i, k: "v" };
}

describe("appendEvent", () => {
  it("appends below the cap without dropping", () => {
    let buf: InputEvent[] = [];
    for (let i = 0; i < 10; i++) buf = appendEvent(buf, ev(i));
    expect(buf.length).toBe(10);
    expect(buf[0].t).toBe(0);
    expect(buf[9].t).toBe(9);
  });

  it("drops the oldest entry on overflow (FIFO)", () => {
    let buf: InputEvent[] = [];
    for (let i = 0; i < EVENT_BUFFER_CAP + 5; i++) buf = appendEvent(buf, ev(i));
    expect(buf.length).toBe(EVENT_BUFFER_CAP);
    // Oldest 5 were dropped, so the first entry is the 6th event we
    // pushed (t=5) and the last is the most recent (t=CAP+4).
    expect(buf[0].t).toBe(5);
    expect(buf[buf.length - 1].t).toBe(EVENT_BUFFER_CAP + 4);
  });

  it("never mutates the input array (immutability invariant)", () => {
    const buf: InputEvent[] = [ev(1), ev(2)];
    const next = appendEvent(buf, ev(3));
    expect(buf.length).toBe(2);
    expect(next.length).toBe(3);
    expect(next).not.toBe(buf);
  });
});

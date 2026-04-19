import { describe, expect, it } from "vitest";
import { emptyHistory, pushEntry, redo, undo, type HistoryEntry } from "./history";

const E1: HistoryEntry = {
  kind: "value",
  index: 0,
  prevValue: 0,
  nextValue: 5,
  prevNotesMask: 0,
};
const E2: HistoryEntry = {
  kind: "value",
  index: 1,
  prevValue: 0,
  nextValue: 7,
  prevNotesMask: 0,
};

describe("history stack", () => {
  it("pushes entries and keeps order", () => {
    let h = emptyHistory();
    h = pushEntry(h, E1);
    h = pushEntry(h, E2);
    expect(h.past).toEqual([E1, E2]);
    expect(h.future).toEqual([]);
  });

  it("undo moves to future, redo moves back to past", () => {
    let h = pushEntry(pushEntry(emptyHistory(), E1), E2);
    const u = undo(h)!;
    expect(u.entry).toBe(E2);
    h = u.next;
    expect(h.past).toEqual([E1]);
    expect(h.future).toEqual([E2]);
    const r = redo(h)!;
    expect(r.entry).toBe(E2);
    h = r.next;
    expect(h.past).toEqual([E1, E2]);
    expect(h.future).toEqual([]);
  });

  it("a new edit clears the redo stack", () => {
    let h = pushEntry(pushEntry(emptyHistory(), E1), E2);
    h = undo(h)!.next; // future = [E2]
    const newEdit: HistoryEntry = {
      kind: "value",
      index: 5,
      prevValue: 0,
      nextValue: 9,
      prevNotesMask: 0,
    };
    h = pushEntry(h, newEdit);
    expect(h.future).toEqual([]);
    expect(h.past).toEqual([E1, newEdit]);
  });

  it("undo on an empty stack returns null", () => {
    expect(undo(emptyHistory())).toBeNull();
    expect(redo(emptyHistory())).toBeNull();
  });
});

"use client";

import { useEffect } from "react";
import { useGameStore } from "@/lib/zustand/game-store";

// Single global keyboard listener mounted once per play page. Avoids
// per-cell focus management while still giving us a true keyboard-first
// experience.
//
// Bindings (mirrors the shortcuts overlay):
//   arrows / hjkl: move selection
//   1..9         : input digit (or toggle note in notes mode)
//   0/Backspace  : erase
//   N            : toggle notes mode
//   H            : hint
//   U / Cmd+Z    : undo
//   R / Shift+Cmd+Z : redo
//   Space        : pause/resume
//   Esc          : deselect
export function KeyboardListener({ onShortcuts }: { onShortcuts?: () => void }) {
  const moveSelection = useGameStore((s) => s.moveSelection);
  const inputDigit = useGameStore((s) => s.inputDigit);
  const erase = useGameStore((s) => s.eraseSelection);
  const toggleMode = useGameStore((s) => s.toggleMode);
  const hint = useGameStore((s) => s.hint);
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const togglePause = useGameStore((s) => s.togglePause);
  const selectCell = useGameStore((s) => s.selectCell);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept keys typed into form fields. Prevents the play
      // page from blocking the username field on the profile editor, etc.
      const target = e.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

      const key = e.key;

      if (key === "?" || (e.shiftKey && key === "/")) {
        e.preventDefault();
        onShortcuts?.();
        return;
      }
      if (key === "Escape") {
        selectCell(null);
        return;
      }
      if (key === " ") {
        e.preventDefault();
        togglePause();
        return;
      }

      if (key === "ArrowUp" || key === "k") return moveAndPrevent(e, () => moveSelection(0, -1));
      if (key === "ArrowDown" || key === "j") return moveAndPrevent(e, () => moveSelection(0, 1));
      if (key === "ArrowLeft" || key === "h") return moveAndPrevent(e, () => moveSelection(-1, 0));
      if (key === "ArrowRight" || key === "l") return moveAndPrevent(e, () => moveSelection(1, 0));

      if (key >= "1" && key <= "9") {
        e.preventDefault();
        inputDigit(Number(key));
        return;
      }
      if (key === "0" || key === "Backspace" || key === "Delete") {
        e.preventDefault();
        erase();
        return;
      }

      if (key === "n" || key === "N") return moveAndPrevent(e, toggleMode);
      if (key === "H" || key === "h") {
        // 'h' alone moves selection left (vim binding); only treat 'H'
        // (shift+h) as hint to avoid conflict.
        if (e.shiftKey) {
          e.preventDefault();
          void hint();
        }
        return;
      }

      const meta = e.metaKey || e.ctrlKey;
      if (meta && (key === "z" || key === "Z")) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (key === "u" || key === "U") return moveAndPrevent(e, undo);
      if ((key === "r" || key === "R") && !meta) return moveAndPrevent(e, redo);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    moveSelection,
    inputDigit,
    erase,
    toggleMode,
    hint,
    undo,
    redo,
    togglePause,
    selectCell,
    onShortcuts,
  ]);

  return null;
}

function moveAndPrevent(e: KeyboardEvent, fn: () => void) {
  e.preventDefault();
  fn();
}

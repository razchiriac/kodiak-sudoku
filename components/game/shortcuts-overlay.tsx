"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// "?" overlay listing every keyboard shortcut. Discoverability matters
// for a keyboard-first product, so we surface this from both a header
// button and the `?` keypress.
const SHORTCUTS: ReadonlyArray<{ keys: string[]; label: string }> = [
  { keys: ["←", "→", "↑", "↓"], label: "Move selection" },
  { keys: ["h", "j", "k", "l"], label: "Move (vim)" },
  { keys: ["1", "...", "9"], label: "Place digit (or note in notes mode)" },
  { keys: ["0", "Backspace"], label: "Erase" },
  { keys: ["N"], label: "Toggle notes mode" },
  { keys: ["⇧H"], label: "Hint" },
  { keys: ["U", "⌘Z"], label: "Undo" },
  { keys: ["R", "⇧⌘Z"], label: "Redo" },
  { keys: ["Space"], label: "Pause / resume" },
  { keys: ["Esc"], label: "Deselect" },
  { keys: ["?"], label: "This help" },
];

export function ShortcutsOverlay({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-2 text-sm">
              <span>{s.label}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="min-w-7 rounded border bg-muted px-1.5 py-0.5 text-center text-xs font-mono"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

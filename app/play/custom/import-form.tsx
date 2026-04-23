"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { importPastedPuzzleAction } from "./import-action";

// RAZ-35 — Client form for the paste-a-puzzle page. Owns the textarea
// state, async-validation pending state, and inline error rendering.
// On success, navigates to /play/custom/<hash> via `router.push`.
//
// We deliberately don't wire this through React 19's useActionState:
// the form has a single field and a single async call, so plain local
// state + useTransition is cleaner and keeps the control flow obvious.
export function ImportForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await importPastedPuzzleAction(value);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/play/custom/${res.hash}`);
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label
        className="flex flex-col gap-1 text-sm font-medium"
        htmlFor="paste-textarea"
      >
        <span>Puzzle</span>
        <textarea
          id="paste-textarea"
          className="min-h-[180px] w-full resize-y rounded-md border bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder={
            "530070000\n600195000\n098000060\n800060003\n400803001\n700020006\n060000280\n000419005\n000080079"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          autoCorrect="off"
          aria-describedby={error ? "paste-error" : undefined}
          aria-invalid={error ? true : undefined}
          required
        />
      </label>
      {error ? (
        <p
          id="paste-error"
          role="alert"
          className="text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || value.length === 0}>
          {pending ? "Validating…" : "Play this puzzle"}
        </Button>
      </div>
    </form>
  );
}

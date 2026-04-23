import { notFound } from "next/navigation";
import { customPaste } from "@/lib/flags";
import { ImportForm } from "./import-form";

// RAZ-35 — Paste-a-puzzle import form.
//
// Why Server Component around a Client form:
//   - Flag resolution happens here so the feature gate is enforced
//     before any of the client code even ships to the browser.
//     When the flag is off, this route 404s — matching the
//     /play/quick + /leaderboard/difficulty pattern.
//   - The form itself needs client state (textarea value, async
//     validation result), so ImportForm is a Client Component.
export const dynamic = "force-dynamic";

export default async function CustomPasteEntryPage() {
  const enabled = await customPaste();
  if (!enabled) notFound();
  return (
    <div className="container max-w-2xl py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Paste a puzzle</h1>
        <p className="text-sm text-muted-foreground">
          Import any classic Sudoku from a book, newspaper, or forum. Paste
          the 81 cells as digits (use <code>0</code> or <code>.</code> for
          empties). Separators like spaces, pipes, and dashes are stripped
          automatically.
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Custom imports are practice-only: nothing is saved, nothing is
          submitted to any leaderboard.
        </p>
      </header>
      <ImportForm />
    </div>
  );
}

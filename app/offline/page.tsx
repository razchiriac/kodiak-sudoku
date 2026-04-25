import Link from "next/link";
import { Button } from "@/components/ui/button";

// RAZ-85: offline fallback page used by the root service worker when a
// navigation request fails (e.g. Android TWA launch with no network).
// Keep this page static and dependency-light so it can be cached once
// and served reliably even on flaky mobile data.
export default function OfflinePage() {
  return (
    <section className="mx-auto flex w-full max-w-xl flex-col gap-4 px-4 py-12 text-center sm:py-16">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        You are offline.
      </h1>
      <p className="text-sm text-muted-foreground sm:text-base">
        Sudoku could not reach the network right now. Reconnect and try again.
      </p>
      <div className="mx-auto mt-2">
        <Button asChild>
          <Link href="/">Try again</Link>
        </Button>
      </div>
    </section>
  );
}

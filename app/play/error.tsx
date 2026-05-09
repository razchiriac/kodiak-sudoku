"use client";

import { useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// RAZ-131: error boundary for the /play route segment. Catches
// unhandled errors (DB connection pool exhaustion, network blips) and
// shows a user-friendly retry screen instead of a raw 500.
export default function PlayError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[play] unhandled error", error);
  }, [error]);

  return (
    <div className="container flex max-w-md flex-col items-center justify-center gap-6 py-20 text-center">
      <div className="rounded-full bg-destructive/10 p-4">
        <RefreshCw className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          We had trouble loading this page. This is usually temporary.
        </p>
      </div>
      <Button onClick={reset} className="gap-2">
        <RefreshCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

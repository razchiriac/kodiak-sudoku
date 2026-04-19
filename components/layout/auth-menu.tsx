"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { readPersistedSnapshot } from "@/lib/zustand/game-store";
import { migrateLocalProgressAction } from "@/lib/server/actions";

// Tiny client island that shows "Sign in" or the user's display name.
// We avoid pulling user state into a global Context to keep the dep
// graph small; a single Supabase getSession() call is plenty fast.
export function AuthMenu() {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const sb = getBrowserSupabase();
    sb.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setLoading(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      // First time we see a session in this tab → migrate any anonymous
      // progress. Server action is idempotent and cheap.
      if (event === "SIGNED_IN") {
        const snap = readPersistedSnapshot();
        const saved = snap
          ? {
              puzzleId: snap.meta.puzzleId,
              board: snap.board,
              notesB64: snap.notesB64,
              elapsedMs: snap.elapsedMs,
              mistakes: snap.mistakes,
              hintsUsed: snap.hintsUsed,
              isPaused: snap.isPaused,
            }
          : null;
        void migrateLocalProgressAction({ saved });
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (loading) return <div className="h-9 w-20" />;

  if (!user) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href="/auth/sign-in">Sign in</Link>
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="ghost">
        <Link href="/profile" className="flex items-center gap-1">
          <User className="h-4 w-4" />
          <span className="hidden sm:inline">Profile</span>
        </Link>
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Sign out"
        onClick={async () => {
          await getBrowserSupabase().auth.signOut();
          router.refresh();
        }}
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

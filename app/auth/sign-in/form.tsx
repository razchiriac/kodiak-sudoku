"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getBrowserSupabase } from "@/lib/supabase/browser";

// Sign-in form. Two methods: magic link (primary) and Google (one-click).
// Email/password is intentionally absent — see plan §12.
export function SignInForm() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const next = useSearchParams().get("next") ?? "/profile";

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const sb = getBrowserSupabase();
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    setPending(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  async function signInWithGoogle() {
    const sb = getBrowserSupabase();
    await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
  }

  if (sent) {
    return (
      <div className="rounded-lg border bg-card p-4 text-sm">
        Check your email. We sent a magic link to <strong>{email}</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button variant="outline" className="w-full" onClick={signInWithGoogle}>
        Continue with Google
      </Button>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        OR
        <div className="h-px flex-1 bg-border" />
      </div>
      <form onSubmit={sendMagicLink} className="space-y-3">
        <input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending..." : "Send magic link"}
        </Button>
      </form>
    </div>
  );
}

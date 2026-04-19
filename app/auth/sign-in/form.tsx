"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { getBrowserSupabase } from "@/lib/supabase/browser";

// Sign-in form. Two methods: magic link (primary) and Google (one-click).
// Email/password is intentionally absent — see plan §12.
export function SignInForm() {
  const params = useSearchParams();
  // Seed the error state from the URL so callback-route failures
  // (expired magic-link code, OAuth provider error, etc.) surface
  // here. Without this, the user lands back on /auth/sign-in with no
  // explanation. The empty-string fallback collapses to null so the
  // error block stays hidden when there's nothing to show.
  const initialError = params.get("error") || null;
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(false);
  const next = params.get("next") ?? "/profile";

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
    // Reuse the same pending + error state as the magic-link path so
    // the user gets visible feedback. Without this, a misconfigured
    // Google provider (e.g. provider disabled in Supabase) leaves
    // the button doing nothing — the most common failure mode.
    setPending(true);
    setError(null);
    const sb = getBrowserSupabase();
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    // On success the browser navigates away to Google's OAuth screen,
    // so we only land here on error. Clearing pending is still safe
    // because the navigation away unmounts this component.
    if (error) {
      setPending(false);
      setError(error.message);
    }
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
      <Button
        variant="outline"
        className="w-full"
        onClick={signInWithGoogle}
        disabled={pending}
      >
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
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Sending..." : "Send magic link"}
        </Button>
      </form>
      {/* Error is rendered at the bottom (rather than inside the
          magic-link form) so it covers both auth paths. The Google
          path failures used to be silent, which is exactly what the
          user reported. */}
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { getServerSupabase } from "@/lib/supabase/server";

// Magic-link / OAuth landing handler. Supabase appends ?code=... which we
// exchange for a session cookie before redirecting the user back to where
// they came from.
//
// Failure modes we care about:
//   - No `code` param at all (user landed here directly or the provider
//     bailed before redirecting). We send them back to sign-in with a
//     descriptive error so they don't end up silently unsigned at /profile.
//   - exchangeCodeForSession returns an error (expired code, replayed
//     code, misconfigured provider, etc.). Same treatment.
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/profile";
  const errorDescription = url.searchParams.get("error_description");

  // Provider errors arrive as ?error=...&error_description=... (no
  // code). Forward the human-readable description to the sign-in
  // page so the user can see what happened.
  if (errorDescription) {
    return NextResponse.redirect(
      new URL(
        `/auth/sign-in?error=${encodeURIComponent(errorDescription)}`,
        url.origin,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=Missing+code", url.origin),
    );
  }

  const sb = await getServerSupabase();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/auth/sign-in?error=${encodeURIComponent(error.message)}`,
        url.origin,
      ),
    );
  }

  return NextResponse.redirect(new URL(next, url.origin));
}

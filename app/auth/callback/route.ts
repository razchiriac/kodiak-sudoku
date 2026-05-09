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

// RAZ-107: post-auth redirects always land on the canonical domain so the
// session cookie is set on the right origin. Falls back to the request's
// own origin so local dev (where NEXT_PUBLIC_SITE_URL is unset) still works.
const CANONICAL_ORIGIN =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = CANONICAL_ORIGIN || url.origin;
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
        origin,
      ),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/sign-in?error=Missing+code", origin),
    );
  }

  const sb = await getServerSupabase();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      new URL(
        `/auth/sign-in?error=${encodeURIComponent(error.message)}`,
        origin,
      ),
    );
  }

  return NextResponse.redirect(new URL(next, origin));
}

import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// RAZ-107: canonical domain is kodiaksudoku.com.
// Any request arriving on sudoku.kodiak.quest is permanently redirected
// before any auth or page logic runs. This keeps cookies, session handling,
// and OAuth redirects on a single origin.
const CANONICAL_HOST = "kodiaksudoku.com";
const LEGACY_HOST = "sudoku.kodiak.quest";

// Refreshes the Supabase auth cookie on every navigation so users don't
// get silently signed out when their JWT expires.
export async function middleware(request: NextRequest) {
  // Redirect legacy domain to canonical before doing anything else.
  // Using 308 (Permanent Redirect) preserves the HTTP method so POST
  // requests (e.g. server actions) are also redirected correctly.
  const host = request.headers.get("host") ?? "";
  if (host === LEGACY_HOST || host.endsWith(`.${LEGACY_HOST}`)) {
    const url = request.nextUrl.clone();
    url.protocol = "https:";
    url.host = CANONICAL_HOST;
    return NextResponse.redirect(url, 308);
  }

  return updateSession(request);
}

export const config = {
  // Skip middleware on static assets, image optimization, and the
  // favicon. Running it there is pure overhead and would touch Supabase
  // on every CSS / image request.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|\\.well-known/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

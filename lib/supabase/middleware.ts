import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./types";

// Edge-runtime helper that refreshes the Supabase session cookie on
// every navigation. Without this, a user's JWT silently expires after
// ~1 hour (Supabase default) and they get logged out mid-session.
//
// IMPORTANT: do not call any other Supabase methods between
// `createServerClient` and `getUser` here. The Supabase docs warn that
// calling `getUser` is what triggers the cookie refresh; anything in
// between can cause stale-state bugs that are very hard to debug.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet) {
          // Mirror cookies onto BOTH the inbound request (so server
          // components rendered for this request see the fresh values)
          // AND the outbound response (so the browser stores them).
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Triggers the refresh; the result itself is discarded here. The
  // refreshed cookie is what we care about, not the user object.
  await supabase.auth.getUser();

  return response;
}

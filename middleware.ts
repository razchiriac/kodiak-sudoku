import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Refreshes the Supabase auth cookie on every navigation so users don't
// get silently signed out when their JWT expires.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  // Skip middleware on static assets, image optimization, and the
  // favicon. Running it there is pure overhead and would touch Supabase
  // on every CSS / image request.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

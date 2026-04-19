"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

// Singleton browser Supabase client. Used for client-side auth flows
// (magic-link request, OAuth, sign-out). Never used to read app data;
// that goes through server actions / route handlers so RLS policies are
// the only authorization layer in play.
let client: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getBrowserSupabase() {
  if (!client) {
    client = createBrowserClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    );
  }
  return client;
}

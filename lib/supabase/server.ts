import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

// Per-request Supabase client for Server Components and Server Actions.
// Reads/writes auth cookies via Next.js so the SSR session is consistent
// with the client.
export async function getServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: { name: string; value: string; options?: Parameters<typeof cookieStore.set>[2] }[]) {
          // Some Server Components are rendered in a context where setting
          // cookies isn't allowed (e.g. during static prerender). We swallow
          // the error: the next request will get a fresh session if needed.
          try {
            toSet.forEach((c) => cookieStore.set(c.name, c.value, c.options));
          } catch {
            // ignore
          }
        },
      },
    },
  );
}

// Returns the current user (or null) using the cookie session. Cheap to
// call repeatedly because Supabase caches the JWT decode in-process.
export async function getCurrentUser() {
  const sb = await getServerSupabase();
  const { data } = await sb.auth.getUser();
  return data.user ?? null;
}

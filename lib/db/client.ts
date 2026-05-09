import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Single Drizzle client reused across server-side requests. We use
// postgres-js because it has zero CJS overhead and works well with
// serverless/edge cold starts.
//
// IMPORTANT: never import this file from a Client Component. The
// `server-only` import enforces that at build time.

declare global {
  // Cache the driver across hot reloads in dev so we don't exhaust the
  // connection pool every time we save a file. Also cached during the
  // production process for the lifetime of the serverless instance.
  // eslint-disable-next-line no-var
  var __sudokuPg: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __sudokuDb: ReturnType<typeof drizzle<typeof schema>> | undefined;
}

function getConnection() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!globalThis.__sudokuPg) {
    // RAZ-131: reduced from max:5 to max:1. In serverless (Vercel Fluid
    // Compute), each function instance is short-lived and concurrent
    // instances each open their own pool. max:5 × N instances quickly
    // exhausts Supabase's session-mode connection limit, causing
    // "MaxClientsInSessionMode" 500s on /play and /play/[puzzleId].
    globalThis.__sudokuPg = postgres(url, { prepare: false, max: 1, idle_timeout: 20 });
  }
  return globalThis.__sudokuPg;
}

// Lazy proxy so importing this module never triggers a connection.
// This matters during `next build` page-data collection, where pages
// that we marked `force-dynamic` are still imported (just not invoked).
// Without the proxy, a missing DATABASE_URL at build time would crash.
export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_t, prop) {
    if (!globalThis.__sudokuDb) {
      globalThis.__sudokuDb = drizzle(getConnection(), { schema });
    }
    const target = globalThis.__sudokuDb as unknown as Record<string | symbol, unknown>;
    const v = target[prop];
    return typeof v === "function" ? (v as (...args: unknown[]) => unknown).bind(target) : v;
  },
});
export { schema };

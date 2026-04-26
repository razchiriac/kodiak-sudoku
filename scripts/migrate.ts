/* eslint-disable no-console */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

// Apply our hand-written SQL migrations in lexical order. We do not use
// drizzle-kit migrate because we hand-edit migrations to add RLS policies
// and Postgres triggers that drizzle-kit will not generate.
//
// The migrations table is intentionally simple: one row per filename. Re-
// running this script is a no-op for already-applied files.
//
// RAZ-83: local/dev helper only.
// Production uses Supabase migration tracking (`supabase_migrations`).
// We hard-block accidental prod usage unless explicitly overridden.

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const allowProdLegacyMigrate =
    process.env.ALLOW_PROD_LEGACY_MIGRATE === "1" ||
    process.env.ALLOW_PROD_LEGACY_MIGRATE === "true";
  const looksLikeSupabaseHosted = url.includes(".supabase.co");
  const looksLikeProductionEnv =
    process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
  if (looksLikeSupabaseHosted && looksLikeProductionEnv && !allowProdLegacyMigrate) {
    throw new Error(
      [
        "Refusing to run scripts/migrate.ts against Supabase in production.",
        "Use the Supabase migration path for prod (CLI or apply_migration tool) so",
        "tracker state stays aligned with supabase_migrations.",
        "If this is an emergency one-off, rerun with ALLOW_PROD_LEGACY_MIGRATE=1.",
      ].join(" "),
    );
  }

  const sql = postgres(url, { prepare: false, max: 1 });

  await sql`
    create table if not exists "_sudoku_migrations" (
      "filename" text primary key,
      "applied_at" timestamptz not null default now()
    )
  `;

  const dir = path.resolve(process.cwd(), "drizzle/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const applied = await sql<
      { filename: string }[]
    >`select filename from "_sudoku_migrations" where filename = ${file}`;
    if (applied.length > 0) {
      console.log(`[skip] ${file}`);
      continue;
    }
    const body = readFileSync(path.join(dir, file), "utf8");
    console.log(`[apply] ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into "_sudoku_migrations" (filename) values (${file})`;
    });
  }

  console.log("Done.");
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

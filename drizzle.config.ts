import { defineConfig } from "drizzle-kit";

// Drizzle Kit config. Generated migrations live next to the schema so
// they're easy to review in PRs. We never use `drizzle-kit push` against
// production; instead we generate, commit, then run scripts/migrate.ts.
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
});

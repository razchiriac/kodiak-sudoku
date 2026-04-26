/* eslint-disable no-console */
import { execSync } from "node:child_process";

// RAZ-83: CI guard to prevent schema-reference drift.
//
// Fails the build when `lib/db/schema.ts` changes without a matching
// SQL migration file in `drizzle/migrations/`.
//
// Why this exists:
// We previously deployed schema references that expected a new column
// before the migration was applied in prod. This guard blocks the PR at
// CI time instead of discovering the mismatch via runtime 500s.
function run(command: string): string {
  return execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function getDiffRange(): string {
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) return `origin/${baseRef}...HEAD`;
  // Local / push fallback: compare last commit.
  return "HEAD~1...HEAD";
}

function main() {
  const range = getDiffRange();
  let changed: string[] = [];
  try {
    const raw = run(`git diff --name-only ${range}`);
    changed = raw ? raw.split("\n").map((entry) => entry.trim()).filter(Boolean) : [];
  } catch {
    // If diff range is unavailable (e.g., shallow clone edge case),
    // we skip fail-closed behavior and print a warning so CI logs are
    // explicit about the skipped guard.
    console.warn(`[warn] schema-migration guard skipped: unable to diff range ${range}`);
    process.exit(0);
  }

  const schemaTouched = changed.includes("lib/db/schema.ts");
  const migrationTouched = changed.some((file) =>
    /^drizzle\/migrations\/.+\.sql$/.test(file),
  );

  if (schemaTouched && !migrationTouched) {
    console.error(
      [
        "Schema changed without a SQL migration.",
        "Edited: lib/db/schema.ts",
        "Missing: drizzle/migrations/*.sql",
        "Add a migration file (or update an existing pending migration) before merging.",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log("[ok] schema-migration guard passed");
}

main();

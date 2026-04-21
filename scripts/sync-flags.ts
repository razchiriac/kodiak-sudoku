/* eslint-disable no-console */
// Upsert (create-only) every flag in FLAG_REGISTRY into the project's
// Vercel Edge Config store. Safe to run repeatedly — we fetch the
// current items first and ONLY create flags that are missing. Existing
// values (e.g. a flag you flipped to `true` from the dashboard) are
// left untouched.
//
// Run with:
//
//     npm run flags:sync
//
// Env vars (read from .env.local via tsx --env-file):
//
//   EDGE_CONFIG        Full connection string from Vercel
//                      (https://edge-config.vercel.com/<storeId>?token=…).
//                      We only use it to parse the store ID; the read
//                      token inside it is not used for writes.
//   VERCEL_API_TOKEN   Personal access token with write scope on the
//                      team that owns the Edge Config store. Create at
//                      https://vercel.com/account/tokens.
//   VERCEL_TEAM_ID     (optional) Team ID, e.g. "team_xxx". If unset,
//                      we discover it by listing the token's teams and
//                      using the first one — fine for a solo founder
//                      with a single team.

import { FLAG_REGISTRY } from "../lib/flag-registry";

const API_BASE = "https://api.vercel.com";

type EdgeConfigItem = {
  key: string;
  value: unknown;
  description?: string;
};

type VercelTeam = { id: string; slug: string; name: string };

function die(msg: string): never {
  console.error(`sync-flags: ${msg}`);
  process.exit(1);
}

function parseStoreId(connectionString: string): string {
  // Accept both the full connection URL and a bare store ID so the
  // script is forgiving about whatever the user pastes.
  if (connectionString.startsWith("ecfg_")) return connectionString;
  try {
    const url = new URL(connectionString);
    // Path looks like "/ecfg_xxx"; strip the leading slash.
    const id = url.pathname.replace(/^\//, "");
    if (!id.startsWith("ecfg_")) {
      die(`EDGE_CONFIG URL has no ecfg_ id: ${connectionString}`);
    }
    return id;
  } catch {
    die(`EDGE_CONFIG is not a valid URL: ${connectionString}`);
  }
}

async function vercel<T = unknown>(
  path: string,
  token: string,
  teamId: string | null,
  init: RequestInit = {},
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (teamId) url.searchParams.set("teamId", teamId);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Vercel API ${res.status} on ${path}: ${body}`);
  }
  return res.json() as Promise<T>;
}

async function discoverTeamId(token: string): Promise<string | null> {
  // The /v2/teams endpoint returns every team the token can see. For a
  // solo founder there's exactly one; we use it without prompting.
  const data = await vercel<{ teams: VercelTeam[] }>("/v2/teams", token, null);
  if (!data.teams || data.teams.length === 0) return null;
  if (data.teams.length > 1) {
    console.warn(
      `sync-flags: found ${data.teams.length} teams; using "${data.teams[0].slug}". ` +
        "Set VERCEL_TEAM_ID explicitly to disambiguate.",
    );
  }
  return data.teams[0].id;
}

async function main() {
  const token = process.env.VERCEL_API_TOKEN;
  const edgeConfig = process.env.EDGE_CONFIG;
  if (!token) die("VERCEL_API_TOKEN is not set (add it to .env.local)");
  if (!edgeConfig) die("EDGE_CONFIG is not set (add it to .env.local)");

  const storeId = parseStoreId(edgeConfig);
  const teamId = process.env.VERCEL_TEAM_ID ?? (await discoverTeamId(token));
  if (!teamId) die("Could not determine team ID; set VERCEL_TEAM_ID in .env.local");

  console.log(`sync-flags: using store ${storeId} on team ${teamId}`);

  // Fetch current items so we don't clobber anyone's dashboard edits.
  // The API returns the full item array in one call for stores under
  // ~16kb, which is far more than we'll ever need.
  const items = await vercel<EdgeConfigItem[]>(
    `/v1/edge-config/${storeId}/items`,
    token,
    teamId,
  );
  const existingKeys = new Set(items.map((i) => i.key));

  const toCreate = FLAG_REGISTRY.filter((f) => !existingKeys.has(f.key));
  if (toCreate.length === 0) {
    console.log(
      `sync-flags: all ${FLAG_REGISTRY.length} registered flag(s) already in Edge Config. Nothing to do.`,
    );
    return;
  }

  console.log(
    `sync-flags: creating ${toCreate.length} new flag(s): ${toCreate
      .map((f) => f.key)
      .join(", ")}`,
  );

  // Build a single PATCH payload — the items API accepts a batch of
  // operations so we pay one round-trip regardless of how many flags
  // we're syncing.
  const body = {
    items: toCreate.map((f) => ({
      operation: "create" as const,
      key: f.key,
      value: f.defaultValue,
      description: `${f.linearId}: ${f.description}`,
    })),
  };

  await vercel(`/v1/edge-config/${storeId}/items`, token, teamId, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  console.log(`sync-flags: done. ${toCreate.length} flag(s) created.`);
}

main().catch((err: unknown) => {
  console.error("sync-flags failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

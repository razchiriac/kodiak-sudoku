/* eslint-disable no-console */
// Sync every flag in FLAG_REGISTRY into the two places Vercel needs it:
//
//   1. The project's Edge Config store (the RUNTIME source of truth —
//      `lib/flags.ts` calls `get("haptics")` from there on every
//      request).
//   2. The project's Flags dashboard (the METADATA store — what shows
//      up on the /flags/active page in the Vercel UI). Without this,
//      you have to click "+ Create Flag" in the dashboard for every
//      new flag just to see it listed.
//
// Both passes are create-only: we list what already exists and only
// POST the delta. Running the script twice is a no-op.
//
// Run with:
//
//     npm run flags:sync
//
// Env vars (read from .env.local via tsx --env-file):
//
//   EDGE_CONFIG         Full connection string from Vercel
//                       (https://edge-config.vercel.com/<storeId>?token=…).
//                       Only the store ID is used; the read token
//                       inside it is not used for writes.
//   VERCEL_API_TOKEN    Personal access token with write scope on the
//                       team that owns the project. Create at
//                       https://vercel.com/account/tokens.
//   VERCEL_TEAM_ID      (optional) Team ID, e.g. "team_xxx". If unset,
//                       we list the token's teams and use the only one.
//   VERCEL_PROJECT_ID   (optional) Project ID or slug, e.g. "kodiak-sudoku"
//                       or "prj_xxx". Only needed for the Flags-UI
//                       registration step. If unset, we list the team's
//                       projects and use the only one.

import { FLAG_REGISTRY, type FlagSpec } from "../lib/flag-registry";

const API_BASE = "https://api.vercel.com";

type EdgeConfigItem = {
  key: string;
  value: unknown;
  description?: string;
};

type VercelTeam = { id: string; slug: string; name: string };
type VercelProject = { id: string; name: string };

// Shape returned by GET /v1/projects/{id}/feature-flags/flags. We only
// need the slug for the "does it already exist?" check.
type VercelFlagSummary = { slug: string };

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
  // Some PUT/PATCH endpoints return 204 No Content. Guard against
  // JSON.parse on empty body so callers that don't care about the
  // response can just ignore it.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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

async function discoverProjectId(
  token: string,
  teamId: string,
): Promise<string | null> {
  // /v9/projects lists every project on the team. We auto-select when
  // there is exactly one match, otherwise we print the names and ask
  // the user to set VERCEL_PROJECT_ID explicitly.
  const data = await vercel<{ projects: VercelProject[] }>(
    "/v9/projects",
    token,
    teamId,
  );
  const projects = data.projects ?? [];
  if (projects.length === 0) return null;
  if (projects.length === 1) return projects[0].id;
  console.error(
    `sync-flags: found ${projects.length} projects on team ${teamId}. ` +
      "Set VERCEL_PROJECT_ID in .env.local to one of: " +
      projects.map((p) => `"${p.name}"`).join(", "),
  );
  return null;
}

// ---------------------------------------------------------------------
// Step 1: upsert Edge Config items (unchanged behaviour).
// ---------------------------------------------------------------------
async function syncEdgeConfig(
  storeId: string,
  token: string,
  teamId: string,
): Promise<void> {
  // Fetch current items so we don't clobber anyone's dashboard edits.
  const items = await vercel<EdgeConfigItem[]>(
    `/v1/edge-config/${storeId}/items`,
    token,
    teamId,
  );
  const existingKeys = new Set(items.map((i) => i.key));
  const toCreate = FLAG_REGISTRY.filter((f) => !existingKeys.has(f.key));

  if (toCreate.length === 0) {
    console.log(
      `sync-flags: edge-config already has all ${FLAG_REGISTRY.length} flag key(s).`,
    );
    return;
  }

  console.log(
    `sync-flags: creating ${toCreate.length} edge-config item(s): ${toCreate
      .map((f) => f.key)
      .join(", ")}`,
  );
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
  console.log(`sync-flags: edge-config upsert done (${toCreate.length}).`);
}

// ---------------------------------------------------------------------
// Step 2: register the flag in the Flags UI so it shows up in
// /<team>/<project>/flags/active without a manual "+ Create Flag" click.
// This is purely a METADATA write — the runtime value still comes from
// Edge Config via `lib/flags.ts`. Toggling the flag in the Vercel Flags
// UI does NOT change app behaviour; edit the Edge Config Items page
// (or re-run `flags:sync` after updating defaultValue) to do that.
// ---------------------------------------------------------------------

function buildFlagPayload(spec: FlagSpec) {
  // Vercel's managed-flag schema is structured around "variants" that
  // rules/fallthrough/pausedOutcome point at by id. For a boolean flag
  // the canonical variants are just on=true / off=false.
  //
  // We set fallthrough + pausedOutcome to match `defaultValue` so the
  // dashboard's displayed "served value" agrees with the Edge Config
  // seed. Rules are left empty — we only use Vercel Flags for UI
  // visibility, not evaluation.
  const onVariantId = "on";
  const offVariantId = "off";
  const defaultVariantId = spec.defaultValue ? onVariantId : offVariantId;

  const environment = {
    active: true,
    rules: [] as const,
    pausedOutcome: { type: "variant", variantId: offVariantId },
    fallthrough: { type: "variant", variantId: defaultVariantId },
  };

  return {
    slug: spec.key,
    kind: "boolean" as const,
    description: `${spec.linearId}: ${spec.description}`,
    variants: [
      { id: onVariantId, value: true, label: "On" },
      { id: offVariantId, value: false, label: "Off" },
    ],
    environments: {
      production: environment,
      preview: environment,
      development: environment,
    },
  };
}

async function syncFlagsDashboard(
  projectId: string,
  token: string,
  teamId: string,
): Promise<void> {
  // List what's already registered in the Flags UI. The endpoint is
  // paginated but the default page (50 flags) is plenty for us. The
  // response shape is `{ data: [...], pagination: {...} }`.
  const listPath = `/v1/projects/${projectId}/feature-flags/flags`;
  let existingSlugs: Set<string>;
  try {
    const data = await vercel<{ data: VercelFlagSummary[] }>(
      listPath,
      token,
      teamId,
    );
    existingSlugs = new Set((data.data ?? []).map((f) => f.slug));
  } catch (err) {
    // Don't make Edge Config sync fail just because the Flags-UI
    // endpoint isn't reachable (e.g. scope issue on the token).
    console.warn(
      `sync-flags: could not list Flags-UI entries (${
        err instanceof Error ? err.message : String(err)
      }). Skipping dashboard registration.`,
    );
    return;
  }

  const toRegister = FLAG_REGISTRY.filter((f) => !existingSlugs.has(f.key));
  if (toRegister.length === 0) {
    console.log(
      `sync-flags: flags-ui already has all ${FLAG_REGISTRY.length} flag(s).`,
    );
    return;
  }

  console.log(
    `sync-flags: registering ${toRegister.length} flag(s) in flags-ui: ${toRegister
      .map((f) => f.key)
      .join(", ")}`,
  );
  // The create endpoint is one-at-a-time (no batch), so loop. Each
  // failure is logged and skipped — one bad flag shouldn't block the
  // rest.
  for (const spec of toRegister) {
    try {
      await vercel(listPath, token, teamId, {
        method: "PUT",
        body: JSON.stringify(buildFlagPayload(spec)),
      });
      console.log(`sync-flags:   ✓ registered "${spec.key}"`);
    } catch (err) {
      console.warn(
        `sync-flags:   ✗ failed to register "${spec.key}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

async function main() {
  const token = process.env.VERCEL_API_TOKEN;
  const edgeConfig = process.env.EDGE_CONFIG;
  if (!token) die("VERCEL_API_TOKEN is not set (add it to .env.local)");
  if (!edgeConfig) die("EDGE_CONFIG is not set (add it to .env.local)");

  const storeId = parseStoreId(edgeConfig);
  const teamId = process.env.VERCEL_TEAM_ID ?? (await discoverTeamId(token));
  if (!teamId) die("Could not determine team ID; set VERCEL_TEAM_ID in .env.local");

  console.log(`sync-flags: using edge-config ${storeId} on team ${teamId}`);

  // Step 1: Edge Config (runtime source of truth).
  await syncEdgeConfig(storeId, token, teamId);

  // Step 2: Flags dashboard (UI visibility). Best-effort — if it fails
  // we still keep Edge Config consistent.
  const projectId =
    process.env.VERCEL_PROJECT_ID ?? (await discoverProjectId(token, teamId));
  if (!projectId) {
    console.warn(
      "sync-flags: skipping flags-ui registration (no project id). " +
        "Set VERCEL_PROJECT_ID in .env.local to your project slug (e.g. \"kodiak-sudoku\").",
    );
    return;
  }
  console.log(`sync-flags: using project ${projectId}`);
  await syncFlagsDashboard(projectId, token, teamId);

  console.log("sync-flags: done.");
}

main().catch((err: unknown) => {
  console.error("sync-flags failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

/* eslint-disable no-console */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

type AssetLinksEntry = {
  relation?: unknown;
  target?: {
    namespace?: unknown;
    package_name?: unknown;
    sha256_cert_fingerprints?: unknown;
  };
};

const SHA256_FINGERPRINT_RE = /^[A-F0-9]{2}(?::[A-F0-9]{2}){31}$/;
const PACKAGE_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

function parseFingerprints(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function readArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return undefined;
  return arg.slice(prefix.length).trim();
}

function fail(message: string): never {
  throw new Error(message);
}

function validateExpectedConfig(packageName: string, fingerprints: string[]): void {
  if (!packageName) {
    fail(
      "ANDROID_APP_PACKAGE_NAME is required. Add ANDROID_APP_PACKAGE_NAME and ANDROID_APP_SHA256_CERT_FINGERPRINT " +
        "to .env or .env.local (see .env.example). Use the Play App Signing certificate fingerprint from Play Console.",
    );
  }
  if (!PACKAGE_NAME_RE.test(packageName)) {
    fail(`Invalid ANDROID_APP_PACKAGE_NAME: "${packageName}"`);
  }
  if (fingerprints.length === 0) {
    fail(
      "ANDROID_APP_SHA256_CERT_FINGERPRINT is required (comma-separated SHA-256 hex pairs). " +
        "See .env.example; production values often live in .env.local after vercel env pull.",
    );
  }
  for (const fingerprint of fingerprints) {
    if (!SHA256_FINGERPRINT_RE.test(fingerprint)) {
      fail(`Invalid SHA-256 fingerprint: "${fingerprint}"`);
    }
  }
}

function findAndroidTargetEntry(
  payload: unknown,
  packageName: string,
): AssetLinksEntry | null {
  if (!Array.isArray(payload)) return null;
  for (const entry of payload as AssetLinksEntry[]) {
    const relation = Array.isArray(entry.relation) ? entry.relation : [];
    const namespace = entry.target?.namespace;
    const pkg = entry.target?.package_name;
    if (
      namespace === "android_app" &&
      pkg === packageName &&
      relation.includes("delegate_permission/common.handle_all_urls")
    ) {
      return entry;
    }
  }
  return null;
}

/**
 * npm passes `--env-file=.env` only. Many developers keep Android vars in
 * `.env.local` (gitignored) alongside Vercel pulls — merge that file so checks
 * work without duplicating secrets into `.env`.
 */
function mergeEnvLocalOverrides(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

async function main() {
  mergeEnvLocalOverrides();
  const rawBaseUrl =
    readArg("url") ??
    process.env.ANDROID_ASSETLINKS_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "";
  if (!rawBaseUrl) {
    fail("Missing base URL. Set NEXT_PUBLIC_SITE_URL or pass --url=https://your-domain");
  }

  const normalizedBaseUrl = rawBaseUrl.replace(/\/$/, "");
  const packageName = (process.env.ANDROID_APP_PACKAGE_NAME ?? "").trim();
  const fingerprints = parseFingerprints(process.env.ANDROID_APP_SHA256_CERT_FINGERPRINT);
  validateExpectedConfig(packageName, fingerprints);

  const endpoint = `${normalizedBaseUrl}/.well-known/assetlinks.json`;
  console.log(`[check] Fetching ${endpoint}`);

  const response = await fetch(endpoint, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) fail(`Request failed (${response.status} ${response.statusText}).`);

  const payload = (await response.json()) as unknown;
  const entry = findAndroidTargetEntry(payload, packageName);
  if (!entry) {
    fail(
      `No matching android_app entry found for package "${packageName}" with handle_all_urls relation.`,
    );
  }

  const actualFingerprints = Array.isArray(entry.target?.sha256_cert_fingerprints)
    ? (entry.target?.sha256_cert_fingerprints as string[])
    : [];
  if (actualFingerprints.length === 0) {
    fail("Matched entry has no sha256_cert_fingerprints array.");
  }

  const missing = fingerprints.filter((expected) => !actualFingerprints.includes(expected));
  if (missing.length > 0) {
    fail(
      `Fingerprint mismatch. Missing from endpoint: ${missing.join(", ")}`,
    );
  }

  console.log("[ok] assetlinks.json matches expected package + certificate fingerprints.");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[fail] ${message}`);
  process.exit(1);
});

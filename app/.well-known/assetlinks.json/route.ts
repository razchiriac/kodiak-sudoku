import { NextResponse } from "next/server";

// RAZ-85: Android Trusted Web Activity (TWA) origin verification.
//
// Google verifies that the web origin "trusts" the Android package by
// reading this endpoint:
//   https://<origin>/.well-known/assetlinks.json
//
// We keep it dynamic so production and preview environments can use
// different package names/certs without committing secrets into git.
// (The SHA-256 signing cert fingerprint is public metadata, but env
// configuration is still easier than hard-coding it.)
//
// Required env vars for a real TWA association:
// - ANDROID_APP_PACKAGE_NAME (e.g. com.razchiriac.sudoku)
// - ANDROID_APP_SHA256_CERT_FINGERPRINT
//   (uppercase hex pairs separated by colons)
export const dynamic = "force-dynamic";

function parseFingerprints(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export async function GET() {
  const packageName = process.env.ANDROID_APP_PACKAGE_NAME?.trim() ?? "";
  const fingerprints = parseFingerprints(
    process.env.ANDROID_APP_SHA256_CERT_FINGERPRINT,
  );

  if (!packageName || fingerprints.length === 0) {
    // Return an explicit empty array rather than an error so the route
    // remains valid JSON in local dev where Android env vars are absent.
    return new NextResponse(JSON.stringify([], null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  }

  const payload = [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

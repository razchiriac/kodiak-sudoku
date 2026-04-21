import { NextResponse, type NextRequest } from "next/server";
import { verifyAccess, type ApiData } from "flags";
import { getProviderData } from "flags/next";
import * as flags from "@/lib/flags";

// Endpoint that the Vercel Flags toolbar (and the `flags` SDK overrides
// cookie) reads from. Returns metadata about every flag declared in
// lib/flags.ts so the toolbar can render an override UI for each one.
//
// Secured by the FLAGS_SECRET env var: requests must include a matching
// bearer token. Without FLAGS_SECRET set, all requests are rejected -
// the flag *values* still work fine without the toolbar, this route
// just becomes inert.
export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const access = await verifyAccess(request.headers.get("Authorization"));
  if (!access) return NextResponse.json(null, { status: 401 });

  const providerData = getProviderData(flags);
  return NextResponse.json<ApiData>(providerData);
}

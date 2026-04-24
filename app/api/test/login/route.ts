import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";

// RAZ-73 — DEV-ONLY / preview-only test-login route.
//
// This route exists solely to give Playwright a way to obtain a
// real Supabase session cookie without going through the magic-link
// email flow (which requires SMTP and a human inbox). It is locked
// down with two independent guards:
//
//   1. The Vercel production deploy must NEVER serve this. We key
//      off VERCEL_ENV rather than NODE_ENV because Vercel sets
//      NODE_ENV=production for ALL non-`vercel dev` builds (incl.
//      preview deploys), which would lock the route out of CI.
//      VERCEL_ENV is set to "production" only for the actual
//      production deploy; "preview" / "development" are safe.
//      When VERCEL_ENV is unset (e.g. local `next dev` outside
//      Vercel), we treat that as non-production.
//   2. ENABLE_TEST_LOGIN must be exactly "1". Even in dev or on a
//      preview deploy, you have to opt in. Forgetting to set this
//      is the worst that can happen — the route just 404s.
//
// Both guards must be true. If either fails we return 404 (NOT
// 403): a 404 doesn't even confirm the route exists, which is
// the right defence-in-depth posture for a dev-only auth bypass.
//
// In CI (RAZ-73 Phase 3) this means:
//   - Set ENABLE_TEST_LOGIN=1 in the Vercel project's *Preview*
//     environment (Project Settings → Environment Variables).
//     Production must NOT have it set, but even if it leaks,
//     the VERCEL_ENV guard above blocks it.
//   - The GitHub Actions e2e workflow ALSO sets ENABLE_TEST_LOGIN=1
//     on the runner so playwright.config.ts adds the authed
//     projects to the run.
//
// Mechanism:
//   - Service-role admin client looks up (or creates on first
//     call) a fixed test user.
//   - admin.generateLink('magiclink') returns a hashed_token
//     associated with that email.
//   - The SSR-cookie-aware client calls verifyOtp(token_hash) —
//     this is the same code path the production callback uses,
//     so the resulting cookie/session shape is identical to a
//     real magic-link login. No bespoke token shape lurking.
//
// Usage from Playwright:
//   const res = await request.post("/api/test/login", {
//     data: { email: "e2e+playwright@example.test" },
//   });
//   // session cookies are now on the request context;
//   // browserContext.storageState() captures them.

const DEFAULT_TEST_EMAIL = "e2e+playwright@example.test";

// Minimal type for the inbound JSON body. Kept inline rather than
// pulling in Zod here — this route is dev-only and the input is
// trusted by definition (we own the caller).
type LoginBody = { email?: string; next?: string };

function isEnabled(): boolean {
  // Vercel production deploy: hard-block. VERCEL_ENV is set by the
  // Vercel runtime; locally it's undefined, which we treat as safe.
  if (process.env.VERCEL_ENV === "production") return false;
  // Belt-and-braces: even outside Vercel, refuse if NODE_ENV is
  // "production" without VERCEL_ENV being set to something safe.
  // (E.g. someone self-hosting with `next start` and NODE_ENV=production
  // but no Vercel envs at all.) We only allow the "production-y"
  // NODE_ENV when VERCEL_ENV explicitly says preview/development.
  const isProdNode = process.env.NODE_ENV === "production";
  const vercelEnv = process.env.VERCEL_ENV;
  if (isProdNode && vercelEnv !== "preview" && vercelEnv !== "development") {
    return false;
  }
  return process.env.ENABLE_TEST_LOGIN === "1";
}

export async function POST(req: NextRequest) {
  if (!isEnabled()) {
    // Pretend the route doesn't exist. See top-of-file comment
    // for why we deliberately don't 403.
    return new NextResponse(null, { status: 404 });
  }

  // Body is optional; an empty POST logs in as the default user.
  let body: LoginBody = {};
  try {
    body = (await req.json()) as LoginBody;
  } catch {
    // No body — that's fine, fall through to defaults.
  }

  const email = body.email?.trim() || DEFAULT_TEST_EMAIL;
  const next = body.next ?? "/";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "missing SUPABASE_SERVICE_ROLE_KEY or SUPABASE_URL" },
      { status: 500 },
    );
  }

  // Admin client — never persists session, never reads cookies.
  // Used only to provision the user + mint the magiclink token.
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Idempotent provisioning: try to look up the user; create if
  // missing. We can't `getUserByEmail` directly without a paid
  // tier, so we fall back to `admin.generateLink` for both
  // existing and new users — Supabase auto-creates the user when
  // the email isn't already on file (this matches the prod
  // magic-link flow, which also auto-provisions on first sign-in).
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) {
    return NextResponse.json(
      { error: `generateLink failed: ${linkErr.message}` },
      { status: 500 },
    );
  }
  const tokenHash = linkData.properties?.hashed_token;
  if (!tokenHash) {
    return NextResponse.json(
      { error: "no hashed_token in generateLink response" },
      { status: 500 },
    );
  }

  // Use the SSR-cookie-aware client to verify the OTP. This is
  // the production code path: the same setAll() callback writes
  // the auth cookies onto our response. We don't have to know
  // the cookie names or shape — @supabase/ssr handles it.
  const sb = await getServerSupabase();
  const { error: otpErr } = await sb.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
  });
  if (otpErr) {
    return NextResponse.json(
      { error: `verifyOtp failed: ${otpErr.message}` },
      { status: 500 },
    );
  }

  // Tests typically discard the response body and capture the
  // cookies from the browser context. We still return JSON so a
  // human running curl can sanity-check.
  return NextResponse.json(
    { ok: true, email, next },
    {
      status: 200,
      // Mirror NextResponse's default cookie pass-through —
      // verifyOtp wrote them to the response that getServerSupabase
      // is ultimately tied to.
    },
  );
}

// Allow GET as a convenience for `curl http://localhost:3000/api/test/login`
// during local debugging. Same guards.
export async function GET(req: NextRequest) {
  if (!isEnabled()) return new NextResponse(null, { status: 404 });
  // Reuse POST with an empty body so behaviour stays in one place.
  return POST(
    new NextRequest(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify({}),
    }),
  );
}

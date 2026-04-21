import "server-only";
import { flag } from "flags/next";

// Central registry for every feature flag in the app. One flag per Linear
// ticket; the ticket ID lives in the description so cleanup is easy to
// find later.
//
// Defaults intentionally fall back to `false` in production. Each flag
// reads its state from a `FLAG_*` env var so we can configure it per
// Vercel environment (typically Preview = true, Production = false).
//
// Usage from a Server Component or Server Action:
//
//     import { pbRibbon } from "@/lib/flags";
//     const show = await pbRibbon();
//
// For Client Components, evaluate on the server and pass the resolved
// value (or the derived data) as a prop. Don't import this module from
// "use client" files — it's server-only on purpose so the client bundle
// stays lean.

// RAZ-22 - Personal-best ribbon in the completion modal.
// When on, the play page fetches the user's previous best time for the
// puzzle's difficulty and the completion modal renders a "New best!"
// ribbon if the current finish beats it.
export const pbRibbon = flag<boolean>({
  key: "pb-ribbon",
  description: "RAZ-22: show personal-best ribbon in completion modal.",
  defaultValue: false,
  options: [
    { value: false, label: "Off" },
    { value: true, label: "On" },
  ],
  decide: () => process.env.FLAG_PB_RIBBON === "true",
});

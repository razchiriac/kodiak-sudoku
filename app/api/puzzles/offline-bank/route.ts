// RAZ-106: Offline puzzle bank endpoint.
//
// Returns a batch of random puzzles per difficulty bucket so the client can
// populate its IndexedDB puzzle bank and start new games without a network
// connection.
//
// Auth: not required. Random puzzles already expose their solution to the
// client (it is passed as a prop to PlayClient for the live mistake-check
// feature), so returning `solution` here does not increase attack surface.
// Daily puzzles are intentionally excluded — their solutions are server-only.
//
// Query params:
//   buckets  Comma-separated difficulty buckets to fetch (1–4). Default: 1,2,3,4.
//   count    Puzzles per bucket. Max 10. Default: 5.

import { getRandomPuzzlesByBucket } from "@/lib/db/queries";

const VALID_BUCKETS = new Set([1, 2, 3, 4]);
const MAX_COUNT = 10;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const buckets = (searchParams.get("buckets") ?? "1,2,3,4")
    .split(",")
    .map(Number)
    .filter((b) => VALID_BUCKETS.has(b));

  const count = Math.min(
    Math.max(1, parseInt(searchParams.get("count") ?? "5", 10) || 5),
    MAX_COUNT,
  );

  const results = await Promise.all(
    buckets.map((b) => getRandomPuzzlesByBucket(b, count)),
  );

  const allPuzzles = results.flat().map((p) => ({
    id: p.id,
    puzzle: p.puzzle,
    solution: p.solution,
    difficultyBucket: p.difficultyBucket,
    variant: p.variant,
  }));

  return Response.json(
    { puzzles: allPuzzles },
    {
      headers: {
        // No caching — each call should return a fresh random sample so
        // the bank stays varied across refreshes.
        "Cache-Control": "no-store",
      },
    },
  );
}

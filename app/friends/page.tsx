import { redirect } from "next/navigation";
import Link from "next/link";
import { UserPlus } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  listFriends,
  listIncomingRequests,
  listOutgoingRequests,
} from "@/lib/server/friends";
import { FriendRequestForm } from "./request-form";
import { FriendActionButton } from "./action-button";

// RAZ-12 — Friends management page.
//
// Three sections:
//   Incoming — requests awaiting my action (accept / decline).
//   Friends  — accepted relationships (remove button).
//   Outgoing — I sent these, awaiting their action (cancel).
//
// The page is a server component; mutations go through the
// actions in lib/server/actions.ts via two small client
// components (the send form + the per-row buttons).

export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/friends");

  // Fetch all three lists in parallel — each is a small index
  // lookup, so we don't bother consolidating into one SQL trip.
  const [friends, incoming, outgoing] = await Promise.all([
    listFriends(user.id),
    listIncomingRequests(user.id),
    listOutgoingRequests(user.id),
  ]);

  return (
    <div className="container max-w-2xl py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Friends</h1>
        <p className="text-sm text-muted-foreground">
          Add friends by username to unlock the private leaderboard tab.
        </p>
      </header>

      <section className="mb-8 rounded-lg border bg-card p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <UserPlus className="h-4 w-4" /> Add a friend
        </h2>
        <FriendRequestForm />
      </section>

      {incoming.length > 0 ? (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Requests ({incoming.length})
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {incoming.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <span className="flex-1 truncate">
                  <Link
                    className="font-medium hover:underline"
                    href={`/profile/${r.username ?? r.id}`}
                  >
                    {r.displayName ?? r.username ?? "Anonymous"}
                  </Link>
                  {r.username ? (
                    <span className="ml-2 text-muted-foreground">
                      @{r.username}
                    </span>
                  ) : null}
                </span>
                <FriendActionButton
                  action="accept"
                  userId={r.id}
                  label="Accept"
                  icon="check"
                />
                <FriendActionButton
                  action="remove"
                  userId={r.id}
                  label="Decline"
                  icon="x"
                  variant="ghost"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Your friends ({friends.length})
        </h2>
        {friends.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No friends yet. Send a request above to get started.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {friends.map((f) => (
              <li
                key={f.id}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <span className="flex-1 truncate">
                  <Link
                    className="font-medium hover:underline"
                    href={`/profile/${f.username ?? f.id}`}
                  >
                    {f.displayName ?? f.username ?? "Anonymous"}
                  </Link>
                  {f.username ? (
                    <span className="ml-2 text-muted-foreground">
                      @{f.username}
                    </span>
                  ) : null}
                </span>
                <FriendActionButton
                  action="remove"
                  userId={f.id}
                  label="Remove"
                  icon="x"
                  variant="ghost"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {outgoing.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Pending (sent)
          </h2>
          <ul className="divide-y rounded-lg border bg-card">
            {outgoing.map((r) => (
              <li
                key={r.id}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <span className="flex-1 truncate text-muted-foreground">
                  {r.displayName ?? r.username ?? "Anonymous"}
                  {r.username ? ` (@${r.username})` : ""}
                </span>
                <FriendActionButton
                  action="remove"
                  userId={r.id}
                  label="Cancel"
                  icon="x"
                  variant="ghost"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </div>
  );
}

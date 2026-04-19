"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { updateProfileAction } from "@/lib/server/actions";

// Profile form. Posts straight to a server action; we keep state minimal
// because there are only two fields.
export function ProfileEditForm({
  currentUsername,
  currentDisplayName,
}: {
  currentUsername: string;
  currentDisplayName: string;
}) {
  const [username, setUsername] = useState(currentUsername);
  const [displayName, setDisplayName] = useState(currentDisplayName);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        const res = await updateProfileAction({
          username: username.trim().toLowerCase(),
          displayName: displayName.trim() || undefined,
        });
        setPending(false);
        if (!res.ok) {
          setError(
            res.error === "username_taken"
              ? "That username is already taken."
              : "Could not save profile.",
          );
          return;
        }
        router.push(`/profile/${username.trim().toLowerCase()}`);
      }}
      className="space-y-4"
    >
      <div>
        <label htmlFor="username" className="mb-1 block text-sm font-medium">
          Username
        </label>
        <input
          id="username"
          required
          minLength={3}
          maxLength={24}
          pattern="[a-z0-9_-]+"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      <div>
        <label htmlFor="display" className="mb-1 block text-sm font-medium">
          Display name <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id="display"
          maxLength={40}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
}

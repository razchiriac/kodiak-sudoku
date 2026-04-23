"use client";

// RAZ-12 — Username input for sending a friend request.
// Thin wrapper around the sendFriendRequestAction server action
// with an optimistic toast on success and a mapped error toast.
//
// We keep the form tiny on purpose: single input + button. The
// list below refreshes via revalidatePath on the server side so
// we don't need to track state here beyond the in-flight flag.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { sendFriendRequestAction } from "@/lib/server/actions";
import { Button } from "@/components/ui/button";

const ERROR_COPY: Record<string, string> = {
  unauthenticated: "You need to sign in first.",
  invalid_username: "Usernames are letters, numbers, dashes, dots, underscores.",
  user_not_found: "No user with that username.",
  cannot_friend_self: "You cannot befriend yourself.",
  already_friends: "You are already friends.",
  already_pending: "A request is already pending.",
  blocked: "Request blocked.",
};

export function FriendRequestForm() {
  const [value, setValue] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = () => {
    const v = value.trim().replace(/^@/, "");
    if (!v) return;
    startTransition(async () => {
      const res = await sendFriendRequestAction(v);
      if (res.ok) {
        toast.success(`Request sent to @${v}`);
        setValue("");
      } else {
        toast.error(ERROR_COPY[res.error] ?? "Could not send request.");
      }
    });
  };

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        type="text"
        inputMode="text"
        autoComplete="off"
        placeholder="@username"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        aria-label="Friend username"
      />
      <Button type="submit" disabled={isPending || value.trim().length === 0}>
        <UserPlus className="mr-2 h-4 w-4" />
        Send
      </Button>
    </form>
  );
}

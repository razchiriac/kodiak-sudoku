"use client";

// RAZ-12 — Accept / decline / remove buttons on the Friends page.
// One client component handles all three verbs so the shared
// optimistic UI + toast path lives in one place.

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import {
  acceptFriendRequestAction,
  removeFriendshipAction,
} from "@/lib/server/actions";
import { Button } from "@/components/ui/button";

type Action = "accept" | "remove";
type IconName = "check" | "x";
type Variant = "default" | "ghost";

const ICONS: Record<IconName, React.ComponentType<{ className?: string }>> = {
  check: Check,
  x: X,
};

export function FriendActionButton({
  action,
  userId,
  label,
  icon,
  variant = "default",
}: {
  action: Action;
  userId: string;
  label: string;
  icon: IconName;
  variant?: Variant;
}) {
  const [isPending, startTransition] = useTransition();
  const Icon = ICONS[icon];

  const onClick = () => {
    startTransition(async () => {
      const res =
        action === "accept"
          ? await acceptFriendRequestAction(userId)
          : await removeFriendshipAction(userId);
      if (res.ok) {
        // Action-specific copy feels better than a generic
        // "Success" toast — users should know WHAT just happened,
        // especially for the destructive remove/decline path.
        if (action === "accept") toast.success("Friend added");
        else toast.success("Done");
      } else {
        toast.error("Could not complete that action.");
      }
    });
  };

  return (
    <Button
      onClick={onClick}
      disabled={isPending}
      size="sm"
      variant={variant}
      aria-label={label}
      type="button"
    >
      <Icon className="mr-1 h-4 w-4" />
      {label}
    </Button>
  );
}

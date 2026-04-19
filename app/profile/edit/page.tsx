import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/db/queries";
import { ProfileEditForm } from "./form";

export const dynamic = "force-dynamic";

// One-time profile setup. The user lands here after their first sign-in
// because /profile redirects here when no username is set.
export default async function ProfileEditPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/profile");
  const profile = await getProfileById(user.id);
  return (
    <div className="container max-w-md py-10">
      <h1 className="mb-1 text-2xl font-bold">Set your username</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Your username appears on the leaderboard and on your public profile page. Use lowercase
        letters, numbers, dashes, and underscores.
      </p>
      <ProfileEditForm
        currentUsername={profile?.username ?? ""}
        currentDisplayName={profile?.displayName ?? ""}
      />
    </div>
  );
}

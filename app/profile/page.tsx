import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/supabase/server";
import { getProfileById } from "@/lib/db/queries";

export const dynamic = "force-dynamic";

// /profile resolves to either the user's public profile (if they have a
// username) or the profile editor.
export default async function ProfileRedirect() {
  const user = await getCurrentUser();
  if (!user) redirect("/auth/sign-in?next=/profile");
  const profile = await getProfileById(user.id);
  if (!profile?.username) redirect("/profile/edit");
  redirect(`/profile/${profile.username}`);
  // Unreachable; kept for type-check happiness.
  return <Link href="/">Home</Link>;
}

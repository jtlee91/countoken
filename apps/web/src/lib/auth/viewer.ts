import "server-only";

import type { User } from "@supabase/supabase-js";

import { hasPublicSupabaseEnv } from "@/lib/env";
import type { ViewerProfile } from "@/lib/data/models";
import { createClient } from "@/lib/supabase/server";

type ProfileRow = {
  user_id: string;
  display_name: string;
  avatar_style: string;
  ranking_opt_in: boolean;
};

export type ViewerContext = {
  viewer: ViewerProfile | null;
  authenticated: boolean;
};

function makeInitial(displayName: string) {
  const first = displayName.trim().charAt(0);
  return first ? first.toUpperCase() : "T";
}

function makeDefaultDisplayName(user: User) {
  const metadataName = user.user_metadata?.full_name || user.user_metadata?.name;

  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim().slice(0, 40);
  }

  return `Pilot ${user.id.slice(0, 4)}`;
}

function makeAvatarUrl(user: User) {
  const metadataAvatar =
    user.user_metadata?.avatar_url || user.user_metadata?.picture;

  return typeof metadataAvatar === "string" && metadataAvatar.trim()
    ? metadataAvatar.trim()
    : null;
}

function toViewer(profile: ProfileRow, user: User): ViewerProfile {
  return {
    userId: user.id,
    displayName: profile.display_name,
    initial: makeInitial(profile.display_name),
    avatarUrl: makeAvatarUrl(user),
    rankingOptIn: profile.ranking_opt_in,
    source: "supabase",
  };
}

async function getOrCreateProfile(user: User): Promise<ProfileRow | null> {
  const supabase = await createClient();
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("user_id, display_name, avatar_style, ranking_opt_in")
    .eq("user_id", user.id)
    .maybeSingle<ProfileRow>();

  if (existingProfile) {
    return existingProfile;
  }

  const displayName = makeDefaultDisplayName(user);
  const { data: insertedProfile, error } = await supabase
    .from("profiles")
    .insert({
      user_id: user.id,
      display_name: displayName,
      avatar_style: "gradient",
      ranking_opt_in: true,
    })
    .select("user_id, display_name, avatar_style, ranking_opt_in")
    .single<ProfileRow>();

  if (error) {
    return {
      user_id: user.id,
      display_name: displayName,
      avatar_style: "gradient",
      ranking_opt_in: true,
    };
  }

  return insertedProfile;
}

export async function getAuthenticatedViewer(): Promise<ViewerProfile | null> {
  if (!hasPublicSupabaseEnv()) {
    return null;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return null;
    }

    const profile = await getOrCreateProfile(user);

    if (!profile) {
      return null;
    }

    return toViewer(profile, user);
  } catch {
    return null;
  }
}

export async function getViewerContext(): Promise<ViewerContext> {
  const viewer = await getAuthenticatedViewer();

  if (viewer) {
    return { viewer, authenticated: true };
  }

  return { viewer: null, authenticated: false };
}

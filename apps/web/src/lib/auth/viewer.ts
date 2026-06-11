import "server-only";

import { trustedAvatarUrl } from "@/lib/avatar";
import { hasPublicSupabaseEnv } from "@/lib/env";
import type { ViewerProfile } from "@/lib/data/models";
import { createClient } from "@/lib/supabase/server";

type ProfileRow = {
  user_id: string;
  display_name: string;
  avatar_style: string;
  avatar_url: string | null;
  ranking_opt_in: boolean;
};

// JWT 클레임에서 화면 표시에 필요한 최소 정보만 사용한다 (인가 판단에는 쓰지 않는다)
type ViewerClaims = {
  sub: string;
  user_metadata?: Record<string, unknown>;
};

export type ViewerContext = {
  viewer: ViewerProfile | null;
  authenticated: boolean;
};

function makeInitial(displayName: string) {
  const first = displayName.trim().charAt(0);
  return first ? first.toUpperCase() : "T";
}

function makeDefaultDisplayName(claims: ViewerClaims) {
  const metadataName =
    claims.user_metadata?.full_name || claims.user_metadata?.name;

  if (typeof metadataName === "string" && metadataName.trim()) {
    return metadataName.trim().slice(0, 40);
  }

  return `Pilot ${claims.sub.slice(0, 4)}`;
}

function makeAvatarUrl(claims: ViewerClaims) {
  // user_metadata는 사용자가 직접 수정할 수 있으므로 검증된 URL만 신뢰한다
  const candidate =
    claims.user_metadata?.avatar_url || claims.user_metadata?.picture;
  return trustedAvatarUrl(typeof candidate === "string" ? candidate : null);
}

function toViewer(profile: ProfileRow, claims: ViewerClaims): ViewerProfile {
  return {
    userId: claims.sub,
    displayName: profile.display_name,
    initial: makeInitial(profile.display_name),
    avatarUrl: makeAvatarUrl(claims),
    rankingOptIn: profile.ranking_opt_in,
    source: "supabase",
  };
}

async function getOrCreateProfile(claims: ViewerClaims): Promise<ProfileRow | null> {
  const supabase = await createClient();
  const avatarUrl = makeAvatarUrl(claims);
  const { data: existingProfile } = await supabase
    .from("profiles")
    .select("user_id, display_name, avatar_style, avatar_url, ranking_opt_in")
    .eq("user_id", claims.sub)
    .maybeSingle<ProfileRow>();

  if (existingProfile) {
    // 구글 프로필 이미지가 바뀌었으면 랭킹 등 공개 화면용으로 동기화해둔다
    if (existingProfile.avatar_url !== avatarUrl) {
      await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl })
        .eq("user_id", claims.sub);
    }

    return { ...existingProfile, avatar_url: avatarUrl };
  }

  const displayName = makeDefaultDisplayName(claims);
  const { data: insertedProfile, error } = await supabase
    .from("profiles")
    .insert({
      user_id: claims.sub,
      display_name: displayName,
      avatar_style: "gradient",
      avatar_url: avatarUrl,
      ranking_opt_in: true,
    })
    .select("user_id, display_name, avatar_style, avatar_url, ranking_opt_in")
    .single<ProfileRow>();

  if (error) {
    return {
      user_id: claims.sub,
      display_name: displayName,
      avatar_style: "gradient",
      avatar_url: avatarUrl,
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
    // 화면 표시용 조회 경로이므로 Auth 서버 왕복 대신 JWT 로컬 검증을 사용한다.
    // 쓰기 작업(actions, login route)은 계속 getUser()로 서버 검증한다.
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims as ViewerClaims | undefined;

    if (!claims?.sub) {
      return null;
    }

    const profile = await getOrCreateProfile(claims);

    if (!profile) {
      return null;
    }

    return toViewer(profile, claims);
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

"use server";

import { redirect } from "next/navigation";

import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function signOutAction() {
  if (hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    // local 스코프: 이 브라우저 세션만 로그아웃한다. 글로벌이면 같은 계정의
    // CLI(token-agent) 세션 refresh token까지 폐기돼 동기화가 끊긴다.
    await supabase.auth.signOut({ scope: "local" });
  }

  redirect("/ranking");
}

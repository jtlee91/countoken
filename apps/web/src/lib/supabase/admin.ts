import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getPublicSupabaseEnv, getServerSupabaseEnv } from "@/lib/env";

export function createAdminClient() {
  const { url } = getPublicSupabaseEnv();
  const { secretKey } = getServerSupabaseEnv();

  return createSupabaseClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

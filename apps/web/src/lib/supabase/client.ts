import { createBrowserClient } from "@supabase/ssr";

import { getPublicSupabaseEnv } from "@/lib/env";

export function createClient() {
  const { url, publishableKey } = getPublicSupabaseEnv();

  return createBrowserClient(url, publishableKey);
}

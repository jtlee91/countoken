"use server";

import { redirect } from "next/navigation";

import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function signOutAction() {
  if (hasPublicSupabaseEnv()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  redirect("/ranking");
}

"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type CreateShareLinkActionResult =
  | { ok: true; publicSlug: string }
  | {
      ok: false;
      errorType: "login_required" | "storage_failed";
      safeMessage: string;
    };

export async function createShareLinkAction(): Promise<CreateShareLinkActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false,
      errorType: "login_required",
      safeMessage: "Login is required to create a share link.",
    };
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("public_slug")
    .eq("user_id", user.id)
    .maybeSingle<{ public_slug: string | null }>();

  if (existing?.public_slug) {
    return { ok: true, publicSlug: existing.public_slug };
  }

  const publicSlug = randomBytes(8).toString("base64url");
  const { error } = await supabase
    .from("profiles")
    .update({ public_slug: publicSlug, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (error) {
    return {
      ok: false,
      errorType: "storage_failed",
      safeMessage: "Share link could not be created.",
    };
  }

  revalidatePath("/ranking");

  return { ok: true, publicSlug };
}

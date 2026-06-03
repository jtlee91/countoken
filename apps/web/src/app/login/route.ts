import { type NextRequest, NextResponse } from "next/server";

import { getSiteUrl, hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function redirectTo(request: NextRequest, path: string) {
  const url = request.nextUrl.clone();
  url.pathname = path;
  url.search = "";
  return NextResponse.redirect(url);
}

function redirectWithAuthMessage(request: NextRequest, message: string) {
  const url = request.nextUrl.clone();
  url.pathname = "/ranking";
  url.search = "";
  url.searchParams.set("auth", message);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  if (!hasPublicSupabaseEnv()) {
    return redirectWithAuthMessage(request, "supabase-env-missing");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    return redirectTo(request, "/me/dashboard");
  }

  const callbackUrl = new URL("/auth/callback", getSiteUrl());
  callbackUrl.searchParams.set("next", "/me/dashboard");

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl.toString(),
    },
  });

  if (error || !data.url) {
    return redirectWithAuthMessage(request, "google-sign-in-failed");
  }

  return NextResponse.redirect(data.url);
}

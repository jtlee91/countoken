import { type NextRequest, NextResponse } from "next/server";

import { hasPublicSupabaseEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/me/dashboard";
  }

  return value;
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

  const code = request.nextUrl.searchParams.get("code");

  if (!code) {
    return redirectWithAuthMessage(request, "missing-code");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirectWithAuthMessage(request, "callback-failed");
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = safeNextPath(request.nextUrl.searchParams.get("next"));
  redirectUrl.search = "";

  return NextResponse.redirect(redirectUrl);
}

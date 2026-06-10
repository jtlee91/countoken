"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ProfileSettingsActionResult =
  | { ok: true; safeMessage: string }
  | {
      ok: false;
      errorType: "login_required" | "invalid_display_name" | "storage_failed";
      safeMessage: string;
    };

export type DeviceRevokeActionResult =
  | { ok: true; safeMessage: string }
  | {
      ok: false;
      errorType: "login_required" | "invalid_device" | "storage_failed";
      safeMessage: string;
    };

async function authenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id ?? null;
}

function cleanDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

export async function updateProfileSettingsAction(input: {
  displayName: string;
  rankingOptIn: boolean;
}): Promise<ProfileSettingsActionResult> {
  const userId = await authenticatedUserId();

  if (!userId) {
    return {
      ok: false,
      errorType: "login_required",
      safeMessage: "Login is required to update settings.",
    };
  }

  const displayName = cleanDisplayName(input.displayName);

  if (!displayName) {
    return {
      ok: false,
      errorType: "invalid_display_name",
      safeMessage: "Display name is required.",
    };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("profiles").upsert(
    {
      user_id: userId,
      display_name: displayName,
      avatar_style: "gradient",
      ranking_opt_in: input.rankingOptIn,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return {
      ok: false,
      errorType: "storage_failed",
      safeMessage: "Profile settings could not be saved.",
    };
  }

  revalidatePath("/ranking");
  revalidatePath("/me/settings");
  revalidatePath("/me/dashboard");

  return { ok: true, safeMessage: "Settings saved." };
}

export async function revokeDeviceAction(
  deviceId: string,
): Promise<DeviceRevokeActionResult> {
  const userId = await authenticatedUserId();

  if (!userId) {
    return {
      ok: false,
      errorType: "login_required",
      safeMessage: "Login is required to revoke a device.",
    };
  }

  if (!deviceId || deviceId.length > 80) {
    return {
      ok: false,
      errorType: "invalid_device",
      safeMessage: "Device id is invalid.",
    };
  }

  const supabase = await createClient();

  const { data: device, error: deviceError } = await supabase
    .from("usage_devices")
    .update({ revoked: true })
    .eq("device_id", deviceId)
    .eq("user_id", userId)
    .select("device_id")
    .maybeSingle<{ device_id: string }>();

  if (deviceError || !device) {
    return {
      ok: false,
      errorType: "storage_failed",
      safeMessage: "Device could not be revoked.",
    };
  }

  revalidatePath("/me/settings");
  revalidatePath("/me/dashboard");

  return { ok: true, safeMessage: "Device revoked." };
}

export async function renameDeviceAction(
  deviceId: string,
  label: string,
): Promise<DeviceRevokeActionResult> {
  const userId = await authenticatedUserId();

  if (!userId) {
    return {
      ok: false,
      errorType: "login_required",
      safeMessage: "Login is required to rename a device.",
    };
  }

  const cleanLabel = label.trim().replace(/\s+/g, " ").slice(0, 60);

  if (!deviceId || deviceId.length > 80 || !cleanLabel) {
    return {
      ok: false,
      errorType: "invalid_device",
      safeMessage: "Device name is invalid.",
    };
  }

  const supabase = await createClient();

  const { data: device, error: deviceError } = await supabase
    .from("usage_devices")
    .update({ device_label: cleanLabel })
    .eq("device_id", deviceId)
    .eq("user_id", userId)
    .select("device_id")
    .maybeSingle<{ device_id: string }>();

  if (deviceError || !device) {
    return {
      ok: false,
      errorType: "storage_failed",
      safeMessage: "Device could not be renamed.",
    };
  }

  revalidatePath("/me/settings");
  revalidatePath("/me/dashboard");

  return { ok: true, safeMessage: "Device renamed." };
}

import { MyPageShell } from "@/components/my-page-shell";
import { SiteShell } from "@/components/site-shell";
import { LoginRequired } from "@/features/personal/login-required";
import { SettingsContent } from "@/features/personal/settings-content";
import { getViewerContext } from "@/lib/auth/viewer";
import type { DashboardDevice } from "@/lib/data/models";
import { createClient } from "@/lib/supabase/server";

type DeviceRow = {
  device_id: string;
  device_label: string;
  last_seen_at: string | null;
  revoked: boolean;
};

async function getSettingsDevices(userId: string): Promise<DashboardDevice[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("usage_devices")
    .select("device_id, device_label, last_seen_at, revoked")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });

  if (error || !data) {
    return [];
  }

  return (data as DeviceRow[]).map((device) => ({
    id: device.device_id,
    label: device.device_label,
    status: device.revoked
      ? "revoked"
      : device.last_seen_at
        ? "connected"
        : "pending",
    lastSeenAt: device.last_seen_at,
  }));
}

export default async function MySettingsPage() {
  const { viewer } = await getViewerContext();

  if (!viewer) {
    return (
      <SiteShell activePath="/me">
        <LoginRequired
          title="로그인이 필요합니다."
          description="설정 화면은 Supabase Auth 세션과 연결된 계정 데이터만 표시합니다."
        />
      </SiteShell>
    );
  }

  const devices = viewer.userId ? await getSettingsDevices(viewer.userId) : [];

  return (
    <SiteShell activePath="/me" viewer={viewer}>
      <MyPageShell activeTab="settings" viewer={viewer}>
        <SettingsContent viewer={viewer} devices={devices} />
      </MyPageShell>
    </SiteShell>
  );
}

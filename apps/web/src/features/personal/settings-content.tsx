"use client";

import { Ban, Loader2, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";

import {
  revokeDeviceAction,
  updateProfileSettingsAction,
  type DeviceRevokeActionResult,
  type ProfileSettingsActionResult,
} from "@/features/personal/actions";
import type { DashboardDevice, ViewerProfile } from "@/lib/data/models";

export function SettingsContent({
  viewer,
  devices,
}: {
  viewer: ViewerProfile;
  devices: DashboardDevice[];
}) {
  const router = useRouter();
  const [settingsResult, setSettingsResult] =
    useState<ProfileSettingsActionResult | null>(null);
  const [revokeResult, setRevokeResult] =
    useState<DeviceRevokeActionResult | null>(null);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeDeviceCount = devices.filter(
    (device) => device.status !== "revoked",
  ).length;

  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateProfileSettingsAction({
        displayName: String(formData.get("display_name") ?? ""),
        rankingOptIn: formData.get("ranking_opt_in") === "on",
      });
      setSettingsResult(result);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  function revokeDevice(deviceId: string) {
    setPendingDeviceId(deviceId);
    startTransition(async () => {
      const result = await revokeDeviceAction(deviceId);
      setRevokeResult(result);
      setPendingDeviceId(null);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <p className="text-sm font-extrabold text-token-green">
          My Page · Settings
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
          계정과 공개 범위
        </h1>
        <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-muted">
          표시명, 랭킹 공개 여부, 기기 연결 해제를 본인 계정 안에서만 관리합니다.
        </p>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <form
          onSubmit={submitSettings}
          className="rounded-lg border border-border bg-surface p-5"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">프로필</h2>
            <span className="rounded-full border border-token-green/30 bg-token-green/10 px-3 py-1 text-xs font-extrabold text-token-green">
              수정 가능
            </span>
          </div>
          <label
            className="text-sm font-extrabold text-muted"
            htmlFor="displayName"
          >
            표시명
          </label>
          <input
            id="displayName"
            name="display_name"
            defaultValue={viewer.displayName}
            className="mt-2 min-h-11 w-full rounded-md border border-border bg-background px-3 text-sm font-bold outline-none focus:border-code-blue"
          />
          <label className="mt-5 flex items-center gap-3 text-sm font-extrabold">
            <input
              type="checkbox"
              name="ranking_opt_in"
              defaultChecked={viewer.rankingOptIn ?? true}
              className="size-4"
            />
            주간 공개 랭킹에 참여
          </label>
          <button
            type="submit"
            disabled={isPending}
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-extrabold text-white hover:bg-[#0f1b14] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
          >
            {isPending ? (
              <Loader2 className="animate-spin" size={17} aria-hidden="true" />
            ) : (
              <Save size={17} aria-hidden="true" />
            )}
            저장
          </button>
          {settingsResult ? (
            <p
              className={
                settingsResult.ok
                  ? "mt-3 rounded-md border border-token-green/30 bg-token-green/10 px-3 py-2 text-sm font-bold text-token-green"
                  : "mt-3 rounded-md border border-alert-red/30 bg-alert-red/5 px-3 py-2 text-sm font-bold text-alert-red"
              }
            >
              {settingsResult.safeMessage}
            </p>
          ) : null}
        </form>

        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 className="text-xl font-black">연결 관리</h2>
            <span className="rounded-full border border-code-blue/30 bg-code-blue/10 px-3 py-1 text-xs font-extrabold text-code-blue">
              {activeDeviceCount} devices
            </span>
          </div>
          {devices.length > 0 ? (
            <div className="grid gap-3">
              {devices.map((device) => (
                <div
                  key={device.id}
                  className="grid gap-3 rounded-md border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black">{device.label}</p>
                    <p className="mt-1 text-xs font-bold text-muted">
                      {device.status === "revoked"
                        ? "revoked"
                        : device.lastSeenAt
                          ? `last seen ${new Date(device.lastSeenAt).toLocaleDateString("ko-KR")}`
                          : "pending"}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={device.status === "revoked" || pendingDeviceId === device.id}
                    onClick={() => revokeDevice(device.id)}
                    className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-alert-red/30 bg-alert-red/5 px-3 text-xs font-extrabold text-alert-red hover:border-alert-red disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-alert-red"
                  >
                    {pendingDeviceId === device.id ? (
                      <Loader2
                        className="animate-spin"
                        size={15}
                        aria-hidden="true"
                      />
                    ) : (
                      <Ban size={15} aria-hidden="true" />
                    )}
                    해제
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
              아직 연결된 기기가 없습니다. 실제 기기 연결 후 해제 가능한 항목만
              이 영역에 표시됩니다.
            </p>
          )}
          {revokeResult ? (
            <p
              className={
                revokeResult.ok
                  ? "mt-3 rounded-md border border-token-green/30 bg-token-green/10 px-3 py-2 text-sm font-bold text-token-green"
                  : "mt-3 rounded-md border border-alert-red/30 bg-alert-red/5 px-3 py-2 text-sm font-bold text-alert-red"
              }
            >
              {revokeResult.safeMessage}
            </p>
          ) : null}
        </article>
      </section>
    </div>
  );
}

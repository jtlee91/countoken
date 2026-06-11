"use client";

import { Laptop, Loader2, Monitor, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  renameDeviceAction,
  revokeDeviceAction,
  updateProfileSettingsAction,
  type DeviceRevokeActionResult,
  type ProfileSettingsActionResult,
} from "@/features/personal/actions";
import type { DashboardDevice, ViewerProfile } from "@/lib/data/models";

function formatLastSeen(value: string | null) {
  if (!value) {
    return "연결 대기";
  }

  const seen = new Date(value);
  const today = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const startOf = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOf(today) - startOf(seen)) / dayMs);

  if (dayDiff <= 0) {
    return "오늘 연결";
  }
  if (dayDiff === 1) {
    return "어제 연결";
  }
  if (dayDiff < 7) {
    return `${dayDiff}일 전 연결`;
  }
  return `${seen.toLocaleDateString("ko-KR")} 연결`;
}

function DeviceIcon({ label }: { label: string }) {
  const isLaptop = /macbook|laptop|노트북|맥북/i.test(label);
  const Icon = isLaptop ? Laptop : Monitor;

  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-md bg-background text-muted">
      <Icon size={20} aria-hidden="true" />
    </span>
  );
}

export function SettingsContent({
  viewer,
  devices,
}: {
  viewer: ViewerProfile;
  devices: DashboardDevice[];
}) {
  const router = useRouter();
  const initialDisplayName = viewer.displayName;
  const initialOptIn = viewer.rankingOptIn ?? true;
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [rankingOptIn, setRankingOptIn] = useState(initialOptIn);
  const [settingsResult, setSettingsResult] =
    useState<ProfileSettingsActionResult | null>(null);
  const [deviceResult, setDeviceResult] =
    useState<DeviceRevokeActionResult | null>(null);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [renamingDeviceId, setRenamingDeviceId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [isPending, startTransition] = useTransition();

  const dirty =
    displayName.trim() !== initialDisplayName || rankingOptIn !== initialOptIn;
  const activeDevices = devices.filter((device) => device.status !== "revoked");

  function submitSettings() {
    startTransition(async () => {
      const result = await updateProfileSettingsAction({
        displayName,
        rankingOptIn,
      });
      setSettingsResult(result);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  function revokeDevice(device: DashboardDevice) {
    const confirmed = window.confirm(
      `'${device.label}' 기기의 연결을 해제할까요?\n해제해도 이미 동기화된 사용량 기록은 유지됩니다.`,
    );
    if (!confirmed) {
      return;
    }

    setPendingDeviceId(device.id);
    startTransition(async () => {
      const result = await revokeDeviceAction(device.id);
      setDeviceResult(result);
      setPendingDeviceId(null);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  function submitRename(device: DashboardDevice) {
    const nextLabel = renameValue.trim();
    if (!nextLabel || nextLabel === device.label) {
      setRenamingDeviceId(null);
      return;
    }

    setPendingDeviceId(device.id);
    startTransition(async () => {
      const result = await renameDeviceAction(device.id, nextLabel);
      setDeviceResult(result);
      setPendingDeviceId(null);
      setRenamingDeviceId(null);
      if (result.ok) {
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <p className="text-sm font-extrabold text-token-green">
          마이페이지 · 설정
        </p>
        <h1 className="mt-2 text-xl font-black tracking-normal sm:text-[28px]">
          계정과 공개 범위
        </h1>
        <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-muted">
          표시명, 랭킹 공개 여부, 기기 연결 해제를 본인 계정 안에서만 관리합니다.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submitSettings();
          }}
          className="min-w-0 rounded-lg border border-border bg-surface p-5"
        >
          <h2 className="text-xl font-black">프로필</h2>
          <label
            className="mt-5 block text-sm font-extrabold text-muted"
            htmlFor="displayName"
          >
            표시명
          </label>
          <input
            id="displayName"
            name="display_name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-border bg-background px-3 text-sm font-bold outline-none focus:border-code-blue"
          />

          <div className="mt-5 flex items-center justify-between gap-4 rounded-md border border-border bg-background p-3.5">
            <div>
              <p className="text-sm font-extrabold">주간 공개 랭킹에 참여</p>
              <p className="mt-0.5 text-xs font-bold text-muted">
                끄면 랭킹과 공유 프로필에서 즉시 제외됩니다.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={rankingOptIn}
              aria-label="주간 공개 랭킹에 참여"
              onClick={() => setRankingOptIn((value) => !value)}
              className={[
                "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                rankingOptIn ? "bg-token-green" : "bg-border",
              ].join(" ")}
            >
              <span
                className={[
                  "absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left]",
                  rankingOptIn ? "left-[22px]" : "left-0.5",
                ].join(" ")}
              />
            </button>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="submit"
              disabled={!dirty || isPending}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-token-green px-5 text-sm font-extrabold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:bg-border disabled:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
            >
              {isPending ? (
                <Loader2 className="animate-spin" size={16} aria-hidden="true" />
              ) : null}
              {dirty ? "저장" : "저장됨 ✓"}
            </button>
            {!dirty ? (
              <span className="text-xs font-bold text-muted">
                변경사항이 있을 때만 활성화됩니다
              </span>
            ) : null}
          </div>
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

        <article className="min-w-0 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-xl font-black">
            연결된 기기{" "}
            <span className="text-sm font-bold text-muted">
              · {activeDevices.length}대
            </span>
          </h2>
          {devices.length > 0 ? (
            <div className="mt-5 grid grid-cols-1 gap-3">
              {devices.map((device) => {
                const revoked = device.status === "revoked";
                const renaming = renamingDeviceId === device.id;

                return (
                  <div
                    key={device.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-surface p-3.5"
                  >
                    <DeviceIcon label={device.label} />
                    <div className="min-w-0 flex-1">
                      {renaming ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={renameValue}
                            autoFocus
                            onChange={(event) =>
                              setRenameValue(event.target.value)
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                submitRename(device);
                              }
                              if (event.key === "Escape") {
                                setRenamingDeviceId(null);
                              }
                            }}
                            maxLength={60}
                            className="min-h-8 w-full max-w-56 rounded-md border border-border bg-background px-2 text-sm font-bold outline-none focus:border-code-blue"
                          />
                          <button
                            type="button"
                            onClick={() => submitRename(device)}
                            className="text-xs font-extrabold text-token-green"
                          >
                            저장
                          </button>
                          <button
                            type="button"
                            onClick={() => setRenamingDeviceId(null)}
                            className="text-xs font-extrabold text-muted"
                          >
                            취소
                          </button>
                        </div>
                      ) : (
                        <p className="flex min-w-0 items-center gap-2 text-sm font-black">
                          <span className="min-w-0 truncate">
                            {device.label}
                          </span>
                          {!revoked ? (
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingDeviceId(device.id);
                                setRenameValue(device.label);
                              }}
                              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] font-extrabold text-token-green hover:underline"
                            >
                              <Pencil size={11} aria-hidden="true" />
                              이름 변경
                            </button>
                          ) : null}
                        </p>
                      )}
                      <p className="mt-1 truncate text-xs font-bold text-muted">
                        {revoked
                          ? "연결 해제됨"
                          : formatLastSeen(device.lastSeenAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={revoked || pendingDeviceId === device.id}
                      onClick={() => revokeDevice(device)}
                      className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-extrabold text-muted transition hover:border-alert-red/40 hover:bg-alert-red/5 hover:text-alert-red disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-alert-red"
                    >
                      {pendingDeviceId === device.id ? (
                        <Loader2
                          className="animate-spin"
                          size={15}
                          aria-hidden="true"
                        />
                      ) : null}
                      연결 해제
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold leading-6 text-muted">
              아직 연결된 기기가 없습니다. 실제 기기 연결 후 해제 가능한 항목만
              이 영역에 표시됩니다.
            </p>
          )}
          {devices.length > 0 ? (
            <p className="mt-4 text-xs font-bold text-muted">
              연결을 해제해도 이미 동기화된 사용량 기록은 유지됩니다.
            </p>
          ) : null}
          {deviceResult ? (
            <p
              className={
                deviceResult.ok
                  ? "mt-3 rounded-md border border-token-green/30 bg-token-green/10 px-3 py-2 text-sm font-bold text-token-green"
                  : "mt-3 rounded-md border border-alert-red/30 bg-alert-red/5 px-3 py-2 text-sm font-bold text-alert-red"
              }
            >
              {deviceResult.safeMessage}
            </p>
          ) : null}
        </article>
      </section>
    </div>
  );
}

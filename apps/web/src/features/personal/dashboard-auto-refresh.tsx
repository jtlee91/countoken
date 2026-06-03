"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function DashboardAutoRefresh({
  intervalMs = 30_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };

    const interval = window.setInterval(refreshIfVisible, intervalMs);

    document.addEventListener("visibilitychange", refreshIfVisible);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [intervalMs, router]);

  return null;
}

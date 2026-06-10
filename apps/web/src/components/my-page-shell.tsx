import Link from "next/link";
import type { ReactNode } from "react";

import type { ViewerProfile } from "@/lib/data/models";

const tabs = [
  { href: "/me/dashboard", label: "대시보드", key: "dashboard" },
  { href: "/me/badges", label: "배지", key: "badges" },
  { href: "/me/settings", label: "설정", key: "settings" },
] as const;

export function MyPageShell({
  activeTab,
  children,
}: {
  activeTab: (typeof tabs)[number]["key"];
  viewer?: ViewerProfile;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="self-start rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-24">
        <nav aria-label="마이페이지 탭" className="grid gap-2 lg:grid-cols-1">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "inline-flex min-h-10 items-center rounded-r-md border-l-[3px] border-token-green bg-token-green/10 px-3 py-2 text-sm font-extrabold text-token-green focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
                    : "inline-flex min-h-10 items-center rounded-r-md border-l-[3px] border-transparent px-3 py-2 text-sm font-extrabold text-muted hover:bg-surface-alt hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

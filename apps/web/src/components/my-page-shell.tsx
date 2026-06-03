import Link from "next/link";
import type { ReactNode } from "react";

import type { ViewerProfile } from "@/lib/data/models";

const tabs = [
  { href: "/me/dashboard", label: "Dashboard", key: "dashboard" },
  { href: "/me/badges", label: "Badges", key: "badges" },
  { href: "/me/settings", label: "Settings", key: "settings" },
] as const;

export function MyPageShell({
  activeTab,
  viewer,
  children,
}: {
  activeTab: (typeof tabs)[number]["key"];
  viewer: ViewerProfile;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="self-start rounded-lg border border-border bg-surface p-4 lg:sticky lg:top-24">
        <div className="border-b border-border px-1 pb-4">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-token-green to-code-blue text-sm font-black text-white">
              {viewer.initial}
            </span>
            <div>
              <strong className="block text-sm font-black">
                {viewer.displayName}
              </strong>
              <span className="mt-0.5 block text-xs font-bold text-muted">
                Supabase account
              </span>
            </div>
          </div>
        </div>
        <nav aria-label="My Page 탭" className="mt-4 grid gap-2 lg:grid-cols-1">
          {tabs.map((tab) => {
            const active = activeTab === tab.key;

            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "inline-flex min-h-10 items-center rounded-md border border-token-green/30 bg-token-green/10 px-3 py-2 text-sm font-extrabold text-foreground shadow-[inset_2px_0_0_var(--token-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
                    : "inline-flex min-h-10 items-center rounded-md px-3 py-2 text-sm font-extrabold text-muted hover:bg-surface-alt hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
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

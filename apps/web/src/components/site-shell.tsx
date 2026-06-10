import { LogIn, LogOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { ViewerAvatar } from "@/components/viewer-avatar";
import { signOutAction } from "@/lib/auth/actions";
import type { ViewerProfile } from "@/lib/data/models";

const navigationItems = [
  { href: "/ranking", label: "랭킹" },
  { href: "/install", label: "설치" },
];

export function SiteShell({
  activePath,
  viewer,
  children,
}: {
  activePath: "/ranking" | "/install" | "/me";
  viewer?: ViewerProfile | null;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto grid min-h-[72px] w-full max-w-7xl grid-cols-1 items-center gap-3 px-4 py-3 sm:px-6 md:grid-cols-[auto_1fr_auto] lg:px-8">
          <Link
            href="/ranking"
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
            aria-label="Ranking 화면으로 이동"
          >
            <Image
              src="/assets/token-plane-logo.png"
              alt=""
              width={52}
              height={52}
              className="size-[52px] shrink-0 rounded-xl object-cover"
            />
            <span className="truncate text-lg font-black">Token Plane</span>
          </Link>

          <nav
            aria-label="주요 화면"
            className="flex min-w-0 justify-start md:justify-center"
          >
            <div className="flex gap-2 overflow-x-auto p-0.5">
              {navigationItems.map((item) => {
                const active = activePath === item.href;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "inline-flex min-h-10 shrink-0 items-center rounded-md border border-token-green/30 bg-token-green/10 px-4 py-2 text-sm font-extrabold text-foreground shadow-[inset_0_-2px_0_var(--token-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
                        : "inline-flex min-h-10 shrink-0 items-center rounded-md border border-transparent px-4 py-2 text-sm font-extrabold text-muted hover:border-border hover:bg-surface-alt hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="flex items-center justify-start gap-2 md:justify-end">
            {viewer ? (
              <>
                <Link
                  href="/me/dashboard"
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-extrabold text-foreground hover:border-token-green hover:bg-token-green/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
                  aria-label={`${viewer.displayName}의 마이페이지`}
                >
                  <ViewerAvatar viewer={viewer} size={32} />
                  <span>{viewer.displayName}</span>
                </Link>
                {viewer.source === "supabase" ? (
                  <form action={signOutAction}>
                    <button
                      type="submit"
                      className="inline-flex min-h-10 items-center rounded-md border border-border bg-surface px-3 py-2 text-sm font-extrabold text-muted hover:border-alert-red hover:text-alert-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
                      aria-label="로그아웃"
                    >
                      <LogOut size={17} aria-hidden="true" />
                    </button>
                  </form>
                ) : null}
              </>
            ) : (
              <Link
                href="/login"
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-extrabold text-muted hover:border-code-blue hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
              >
                <LogIn size={17} aria-hidden="true" />
                로그인
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}

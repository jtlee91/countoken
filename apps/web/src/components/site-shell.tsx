import { LogIn, LogOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { ViewerAvatar } from "@/components/viewer-avatar";
import { signOutAction } from "@/lib/auth/actions";
import type { ViewerProfile } from "@/lib/data/models";

const baseNavItems = [
  { href: "/ranking", label: "랭킹", match: "/ranking" },
  { href: "/install", label: "설치", match: "/install" },
] as const;

const myPageNavItem = {
  href: "/me/dashboard",
  label: "마이페이지",
  match: "/me",
} as const;

export function SiteShell({
  activePath,
  viewer,
  children,
}: {
  activePath: "/ranking" | "/install" | "/me";
  viewer?: ViewerProfile | null;
  children: ReactNode;
}) {
  const navItems = viewer ? [...baseNavItems, myPageNavItem] : baseNavItems;

  return (
    <div className="min-h-screen text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
        <div className="mx-auto grid min-h-14 w-full max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 sm:px-6 md:min-h-[72px] md:gap-3 md:py-3 lg:px-8">
          <Link
            href="/ranking"
            className="flex min-w-0 items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
            aria-label="Ranking 화면으로 이동"
          >
            <Image
              src="/assets/countoken-logo.svg"
              alt=""
              width={52}
              height={52}
              className="size-9 shrink-0 md:size-[52px]"
            />
            <span className="hidden truncate text-xl font-black md:inline">
              Countoken
            </span>
          </Link>

          <nav
            aria-label="주요 화면"
            className="flex min-w-0 justify-center"
          >
            <div className="flex gap-1 overflow-x-auto p-0.5 md:gap-2">
              {navItems.map((item) => {
                const active = activePath === item.match;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "inline-flex min-h-10 shrink-0 items-center rounded-md border border-token-green/30 bg-token-green/10 px-2 py-2 text-[15px] font-extrabold text-foreground shadow-[inset_0_-2px_0_var(--token-green)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue md:px-4 md:text-base"
                        : "inline-flex min-h-10 shrink-0 items-center rounded-md border border-transparent px-2 py-2 text-[15px] font-extrabold text-muted hover:border-border hover:bg-surface-alt hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue md:px-4 md:text-base"
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="flex items-center justify-end gap-2">
            <a
              href="https://github.com/jtlee91/countoken"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub 저장소"
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-transparent px-2 py-2 text-sm font-extrabold text-muted hover:border-border hover:bg-surface-alt hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue md:px-3 md:text-[15px]"
            >
              <svg
                width={18}
                height={18}
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
              </svg>
              <span className="hidden md:inline">GitHub</span>
            </a>
            {viewer ? (
              <>
                <Link
                  href="/me/dashboard"
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-transparent px-1.5 py-1.5 text-[15px] font-extrabold text-foreground hover:bg-surface-alt focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue md:px-2"
                  aria-label={`${viewer.displayName}의 마이페이지`}
                >
                  <ViewerAvatar viewer={viewer} size={32} />
                  <span className="hidden md:inline">{viewer.displayName}</span>
                </Link>
                {viewer.source === "supabase" ? (
                  <form action={signOutAction} className="hidden md:block">
                    <button
                      type="submit"
                      className="inline-flex min-h-10 items-center rounded-md border border-transparent px-2.5 py-2 text-sm font-extrabold text-muted hover:bg-surface-alt hover:text-alert-red focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
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
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm font-extrabold text-muted hover:border-code-blue hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue md:text-[15px]"
              >
                <LogIn size={17} aria-hidden="true" className="hidden md:block" />
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

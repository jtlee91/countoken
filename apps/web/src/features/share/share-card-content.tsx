import Image from "next/image";
import Link from "next/link";

import type { ShareCard } from "@/lib/data/models";

export function ShareCardContent({ card }: { card: ShareCard }) {
  return (
    <div className="mx-auto max-w-3xl">
      <article className="overflow-hidden rounded-lg border border-border bg-surface shadow-[0_18px_45px_rgba(29,45,37,0.09)]">
        <div className="border-b border-border bg-gradient-to-r from-token-green/15 via-code-blue/10 to-badge-gold/15 p-6">
          <div className="flex items-center gap-3">
            <Image
              src="/assets/token-plane-logo.png"
              alt=""
              width={52}
              height={52}
              className="size-[52px] rounded-xl object-cover"
            />
            <div>
              <p className="text-sm font-extrabold text-token-green">
                {card.serviceName}
              </p>
              <h1 className="text-2xl font-black tracking-normal">
                {card.periodLabel}
              </h1>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <p className="text-sm font-extrabold text-muted">공유 사용자</p>
              <p className="mt-1 text-3xl font-black">{card.displayName}</p>
            </div>
            <div className="rounded-lg border border-border bg-background p-4 text-right">
              <p className="text-sm font-extrabold text-muted">주간 순위</p>
              <p className="mt-1 font-mono text-4xl font-black">
                {card.rankPosition ? `#${card.rankPosition}` : "-"}
              </p>
              <p className="mt-1 font-mono text-xl font-black text-token-green">
                {card.scoreLabel ?? "집계 대기"}
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-black">보유 배지</p>
            {card.badges.length > 0 ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {card.badges.map((badge) => (
                  <div
                    key={badge.key}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background p-3"
                  >
                    <Image
                      src={badge.iconPath}
                      alt={badge.name}
                      width={48}
                      height={48}
                      className="size-12 rounded-full object-cover"
                    />
                    <div>
                      <p className="text-sm font-black">{badge.name}</p>
                      <p className="mt-1 text-xs font-bold text-muted">
                        획득일 {badge.earnedAt}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 rounded-md border border-dashed border-border bg-background p-4 text-sm font-bold text-muted">
                아직 공유 가능한 배지가 없습니다.
              </p>
            )}
          </div>

          <Link
            href="/ranking"
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-token-green px-4 py-2 text-sm font-extrabold text-white hover:bg-[#127f45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
          >
            Ranking 보기
          </Link>
        </div>
      </article>
    </div>
  );
}

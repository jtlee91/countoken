import Image from "next/image";

import type { BadgeDefinition } from "@/lib/data/models";
import type { ViewerProfile } from "@/lib/data/models";

export function BadgesContent({
  viewer,
  badges,
}: {
  viewer: ViewerProfile;
  badges: BadgeDefinition[];
}) {
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-surface p-5 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <p className="text-sm font-extrabold text-token-green">
          My Page · Badges
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
          {viewer.displayName}의 뱃지 컬렉션
        </h1>
        <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-muted">
          Supabase profile 기준 사용자에게 연결된 배지 화면입니다.
        </p>
      </section>

      {badges.length > 0 ? (
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {badges.map((badge) => {
            const earned = Boolean(badge.earnedAt);

            return (
              <article
                key={badge.key}
                className={
                  earned
                    ? "min-h-[178px] rounded-lg border border-border bg-surface p-5"
                    : "min-h-[178px] rounded-lg border border-border bg-white/60 p-5 text-foreground/60"
                }
              >
                <div className="mb-5 flex items-center justify-between gap-3">
                  <span
                    className={
                      earned
                        ? "grid size-[62px] place-items-center overflow-hidden rounded-full bg-white shadow-[0_8px_18px_rgba(29,45,37,0.14)]"
                        : "grid size-[62px] place-items-center overflow-hidden rounded-full bg-[#f4f7f5] shadow-[0_8px_18px_rgba(29,45,37,0.08)]"
                    }
                  >
                    <Image
                      src={badge.iconPath}
                      alt={`${badge.name} 배지 아이콘`}
                      width={62}
                      height={62}
                      className={
                        earned
                          ? "size-full object-cover"
                          : "size-full object-cover opacity-60 grayscale contrast-75"
                      }
                    />
                  </span>
                  <span
                    className={
                      earned
                        ? "rounded-full border border-badge-gold/30 bg-[#fff0c2] px-3 py-1 text-xs font-extrabold text-[#9a6400]"
                        : "rounded-full border border-border bg-background px-3 py-1 text-xs font-extrabold text-muted"
                    }
                  >
                    {earned ? "획득" : "미획득"}
                  </span>
                </div>
                <h2 className="text-lg font-black">{badge.name}</h2>
                <p className="mt-2 text-sm font-bold leading-6 text-muted">
                  {badge.description}
                </p>
                <p className="mt-3 text-xs font-extrabold leading-5 text-muted">
                  {badge.progress}
                </p>
                {badge.earnedAt ? (
                  <p className="mt-2 text-xs font-extrabold leading-5 text-muted">
                    획득일 {badge.earnedAt}
                  </p>
                ) : null}
              </article>
            );
          })}
        </section>
      ) : (
        <section className="rounded-lg border border-dashed border-border bg-surface p-5">
          <p className="text-lg font-black">아직 표시할 배지가 없습니다.</p>
          <p className="mt-2 text-sm font-bold leading-6 text-muted">
            배지 정의 또는 사용자 획득 내역이 Supabase에 들어오면 이 영역에
            실제 데이터만 표시됩니다.
          </p>
        </section>
      )}
    </div>
  );
}

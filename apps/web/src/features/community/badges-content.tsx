import Image from "next/image";

import type { BadgeDefinition } from "@/lib/data/models";
import type { ViewerProfile } from "@/lib/data/models";

function BadgeCard({ badge }: { badge: BadgeDefinition }) {
  const earned = Boolean(badge.earnedAt);

  return (
    <article
      className={
        earned
          ? "rounded-lg border border-border bg-surface p-5"
          : "rounded-lg border border-border bg-white/60 p-5"
      }
    >
      <div className="flex items-start justify-between gap-3">
        <span
          className={
            earned
              ? "grid size-[62px] place-items-center overflow-hidden rounded-full bg-white shadow-[0_8px_18px_rgba(29,45,37,0.14)]"
              : "grid size-[62px] place-items-center overflow-hidden rounded-full bg-[#f4f7f5]"
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
                : "size-full object-cover opacity-55 grayscale"
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
          {earned ? "✓ 획득" : "🔒 잠김"}
        </span>
      </div>
      <h2
        className={
          earned
            ? "mt-4 text-lg font-black"
            : "mt-4 text-lg font-black text-foreground/70"
        }
      >
        {badge.name}
      </h2>
      <p className="mt-1.5 text-xs font-semibold leading-5 text-muted">
        {badge.description}
      </p>
      {earned ? (
        <>
          <p className="mt-3 rounded-md bg-token-green/10 px-2.5 py-2 text-sm font-extrabold leading-5">
            {badge.progress}
          </p>
          <p className="mt-2.5 text-xs font-semibold text-muted">
            {badge.earnedAt} 획득
          </p>
        </>
      ) : null}
    </article>
  );
}

export function BadgesContent({
  viewer,
  badges,
}: {
  viewer: ViewerProfile;
  badges: BadgeDefinition[];
}) {
  const earnedBadges = badges.filter((badge) => badge.earnedAt);
  const lockedBadges = badges.filter((badge) => !badge.earnedAt);
  const progressPercent =
    badges.length > 0
      ? Math.round((earnedBadges.length / badges.length) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <section className="flex flex-wrap items-center justify-between gap-8 rounded-lg border border-border bg-surface p-5 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <div>
          <p className="text-sm font-extrabold text-token-green">
            My Page · Badges
          </p>
          <h1 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
            {viewer.displayName}의 배지 컬렉션
          </h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-muted">
            코딩 습관에 따라 자동으로 획득되는 배지입니다. 새 배지는 동기화
            시 바로 반영돼요.
          </p>
        </div>
        {badges.length > 0 ? (
          <div className="w-full max-w-xs">
            <div className="flex items-center justify-between text-sm font-bold">
              <span>컬렉션 달성도</span>
              <span className="font-extrabold text-token-green">
                {earnedBadges.length} / {badges.length} 획득
              </span>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-background">
              <div
                className="h-full rounded-full bg-token-green"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </section>

      {badges.length > 0 ? (
        <>
          {earnedBadges.length > 0 ? (
            <section>
              <h2 className="flex items-center gap-2 text-base font-black">
                획득한 배지
                <span className="rounded-full bg-token-green/10 px-2.5 py-0.5 text-xs font-extrabold text-token-green">
                  {earnedBadges.length}
                </span>
              </h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {earnedBadges.map((badge) => (
                  <BadgeCard key={badge.key} badge={badge} />
                ))}
              </div>
            </section>
          ) : null}

          {lockedBadges.length > 0 ? (
            <section>
              <h2 className="flex items-center gap-2 text-base font-black">
                도전 중
                <span className="rounded-full bg-background px-2.5 py-0.5 text-xs font-extrabold text-muted">
                  {lockedBadges.length}
                </span>
              </h2>
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {lockedBadges.map((badge) => (
                  <BadgeCard key={badge.key} badge={badge} />
                ))}
              </div>
            </section>
          ) : null}
        </>
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

import Image from "next/image";

import { CopyLinkButton } from "@/components/copy-link-button";
import {
  type BadgeDefinition,
  type RankingEntry,
  type ViewerProfile,
  type ViewerRankingSummary,
  type ViewerWeeklyUsageSummary,
} from "@/lib/data/models";
import { formatTokenAmount } from "@/lib/format/tokens";

function RankMark({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="grid size-[58px] place-items-center" aria-label="1위">
        <Image
          src="/assets/rank-one-crown.png"
          alt=""
          width={58}
          height={58}
          className="size-[58px] object-contain"
        />
      </span>
    );
  }

  return (
    <span className="grid size-9 place-items-center rounded-md bg-badge-gold/15 font-mono text-sm font-black text-[#9a6400]">
      {rank}
    </span>
  );
}

export function RankingContent({
  viewer,
  entries,
  viewerBadges,
  viewerRanking,
  viewerWeeklyUsage,
  viewerShareSlug,
}: {
  viewer?: ViewerProfile | null;
  entries: RankingEntry[];
  viewerBadges: BadgeDefinition[];
  viewerRanking: ViewerRankingSummary | null;
  viewerWeeklyUsage: ViewerWeeklyUsageSummary | null;
  viewerShareSlug: string | null;
}) {
  const sharePath = viewerShareSlug ? `/share/${viewerShareSlug}` : null;
  const viewerScoreLabel =
    viewerRanking?.scoreLabel ??
    (viewerWeeklyUsage ? formatTokenAmount(viewerWeeklyUsage.tokens) : "-");
  const viewerStatusLabel =
    viewerRanking?.rankMovement ??
    (viewerWeeklyUsage ? "이번 주 사용량" : "랭킹 집계 대기");
  const viewerHelperLabel =
    viewerRanking?.topTenGapLabel ??
    (viewerWeeklyUsage
      ? "랭킹은 아직 집계 전이며, 개인 주간 사용량만 표시됩니다."
      : "실제 사용량 집계 후 개인 랭킹 정보가 표시됩니다.");

  return (
    <div
      className={
        viewer
          ? "grid gap-5 lg:grid-cols-[minmax(0,2.6fr)_minmax(300px,0.88fr)]"
          : "grid gap-5"
      }
    >
      <article className="rounded-lg border border-border bg-surface p-5 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-extrabold text-token-green">Ranking</p>
            <h1 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
              Global weekly
            </h1>
          </div>
          <span className="inline-flex min-h-8 items-center rounded-full border border-badge-gold/30 bg-[#fff0c2] px-3 text-xs font-extrabold text-[#9a6400]">
            이번 주 Top 10
          </span>
        </div>

        {entries.length > 0 ? (
          <div className="grid gap-3">
            {entries.map((entry) => {
              const featured = entry.rank === 1;

              return (
                <article
                  key={entry.rank}
                  className={
                    featured
                      ? "grid min-h-[94px] grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-badge-gold/40 bg-gradient-to-r from-badge-gold/15 to-white p-4 shadow-[0_16px_34px_rgba(119,82,13,0.12)] sm:grid-cols-[64px_minmax(0,1fr)_auto]"
                      : "grid grid-cols-[46px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-border bg-background p-3 sm:grid-cols-[46px_minmax(0,1fr)_auto]"
                  }
                >
                  <RankMark rank={entry.rank} />
                  <div className="min-w-0">
                    <p
                      className={
                        featured
                          ? "truncate text-lg font-black"
                          : "truncate text-sm font-extrabold"
                      }
                    >
                      {entry.displayName}
                    </p>
                    <p className="mt-1 truncate text-xs font-bold text-muted">
                      {entry.badgeName} · {entry.movement}
                    </p>
                  </div>
                  <p
                    className={
                      featured
                        ? "col-start-2 font-mono text-2xl font-black sm:col-start-auto"
                        : "col-start-2 font-mono text-base font-black sm:col-start-auto"
                    }
                  >
                    {entry.scoreLabel}
                  </p>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background p-6">
            <p className="text-lg font-black">아직 공개 랭킹 데이터가 없습니다.</p>
            <p className="mt-2 text-sm font-bold leading-6 text-muted">
              실제 사용량 업로드와 랭킹 집계가 들어오면 이 영역에 공개
              opt-in 사용자만 표시됩니다.
            </p>
          </div>
        )}
      </article>

      {viewer ? (
        <aside className="rounded-lg border border-border bg-surface p-5">
          <div className="grid gap-5">
            <div>
              <div className="grid grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-background p-3">
                {viewerRanking?.rankPosition ? (
                  <RankMark rank={viewerRanking.rankPosition} />
                ) : (
                  <span className="grid size-[54px] place-items-center rounded-xl bg-badge-gold/15 font-mono text-lg font-black text-[#9a6400]">
                    -
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-black">
                    {viewer.displayName}
                  </p>
                  <p className="mt-1 truncate text-xs font-bold text-muted">
                    {viewerStatusLabel}
                  </p>
                </div>
                <p className="border-l border-border pl-4 font-mono text-xl font-black">
                  {viewerScoreLabel}
                </p>
              </div>
              <p className="mt-3 text-sm font-bold text-muted">
                {viewerHelperLabel}
              </p>
            </div>

            <div className="border-t border-border pt-5">
              <p className="text-sm font-black">보유 배지</p>
              {viewerBadges.length > 0 ? (
                <div
                  className="mt-3 flex flex-wrap gap-3"
                  aria-label="보유 배지"
                >
                  {viewerBadges.slice(0, 4).map((badge) => (
                    <div
                      key={badge.key}
                      className="grid w-[76px] justify-items-center gap-1"
                    >
                      <Image
                        src={badge.iconPath}
                        alt={badge.name}
                        width={52}
                        height={52}
                        className="size-[52px] rounded-full object-cover shadow-[0_8px_18px_rgba(29,45,37,0.12)]"
                      />
                      <strong className="max-w-full text-center text-xs font-black leading-tight">
                        {badge.name}
                      </strong>
                      <span className="text-center text-[11px] font-extrabold text-muted">
                        {badge.earnedAt?.slice(5)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 rounded-md border border-dashed border-border bg-background px-3 py-2 text-sm font-bold text-muted">
                  아직 획득한 배지가 없습니다.
                </p>
              )}
            </div>

            {sharePath ? (
              <CopyLinkButton url={sharePath} />
            ) : (
              <p className="rounded-md border border-dashed border-border bg-background px-3 py-2 text-sm font-bold text-muted">
                공유 카드는 실제 share card가 생성된 뒤 사용할 수 있습니다.
              </p>
            )}
          </div>
        </aside>
      ) : null}
    </div>
  );
}

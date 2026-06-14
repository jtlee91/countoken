import Image from "next/image";

import { CopyLinkButton } from "@/components/copy-link-button";
import { CreateShareLinkButton } from "@/features/community/create-share-link-button";
import { ProviderShareBar } from "@/features/community/provider-share-bar";
import {
  type BadgeDefinition,
  type RankingEntry,
  type ViewerProfile,
  type ViewerRankingSummary,
  type ViewerWeeklyUsageSummary,
} from "@/lib/data/models";
import { trustedAvatarUrl } from "@/lib/avatar";
import { formatTokenAmount } from "@/lib/format/tokens";

const CLAUDE_COLOR = "#d97757";
const CODEX_COLOR = "#10a37f";

const KOREA_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 현재 KST 기준 이번 주(월~일) 범위를 "6/8(월) ~ 6/14(일)" 형태로 반환한다.
// epoch + 9h로 KST 벽시계를 UTC 필드로 읽어 월요일~일요일을 계산한다.
function currentKoreaWeekRangeLabel(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(
      kst.getUTCFullYear(),
      kst.getUTCMonth(),
      kst.getUTCDate() - daysSinceMonday,
    ),
  );
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${KOREA_WEEKDAYS[d.getUTCDay()]})`;
  return `${fmt(monday)} ~ ${fmt(sunday)}`;
}

function providerPillBackground(claudeTokens: number, codexTokens: number) {
  const total = claudeTokens + codexTokens;

  if (total <= 0) {
    return "#9aa8a0";
  }

  // 한쪽이 극소량이어도 슬리버가 보이도록 4~96%로 클램프한다
  const rawPct = (claudeTokens / total) * 100;
  const claudePct =
    claudeTokens === 0
      ? 0
      : codexTokens === 0
        ? 100
        : Math.min(96, Math.max(4, Math.round(rawPct)));

  return `linear-gradient(90deg, ${CLAUDE_COLOR} 0 ${claudePct}%, ${CODEX_COLOR} ${claudePct}% 100%)`;
}

// 데스크톱(sm 이상) 전용 점수 필 — 모바일에서는 ProviderShareBar로 대체된다
function ProviderScorePill({
  claudeTokens,
  codexTokens,
  scoreLabel,
  featured,
}: {
  claudeTokens: number;
  codexTokens: number;
  scoreLabel: string;
  featured: boolean;
}) {
  const total = claudeTokens + codexTokens;
  const claudePct = total > 0 ? Math.round((claudeTokens / total) * 100) : 0;
  const codexPct = total > 0 ? 100 - claudePct : 0;

  return (
    <span
      className={
        featured
          ? "group relative ml-auto hidden min-w-[128px] shrink-0 items-center justify-center rounded-full px-5 py-2 font-mono text-xl font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.35)] sm:inline-flex"
          : "group relative ml-auto hidden min-w-[108px] shrink-0 items-center justify-center rounded-full px-4 py-1.5 font-mono text-sm font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.35)] sm:inline-flex"
      }
      style={{ background: providerPillBackground(claudeTokens, codexTokens) }}
      tabIndex={0}
    >
      {scoreLabel}
      {total > 0 ? (
        <span className="pointer-events-none absolute bottom-full right-0 z-10 mb-2 hidden whitespace-nowrap rounded-lg bg-foreground px-3.5 py-2.5 text-left font-sans text-xs font-bold leading-6 text-white shadow-[0_10px_26px_rgba(29,45,37,0.28)] [text-shadow:none] group-hover:block group-focus-visible:block">
          <span className="flex items-center gap-2">
            <span
              className="size-2 rounded-[3px]"
              style={{ background: CLAUDE_COLOR }}
            />
            Claude Code {formatTokenAmount(claudeTokens)} · {claudePct}%
          </span>
          <span className="flex items-center gap-2">
            <span
              className="size-2 rounded-[3px]"
              style={{ background: CODEX_COLOR }}
            />
            Codex {formatTokenAmount(codexTokens)} · {codexPct}%
          </span>
        </span>
      ) : null}
    </span>
  );
}

function EntryAvatar({
  entry,
  featured,
}: {
  entry: RankingEntry;
  featured: boolean;
}) {
  // 모바일에서는 1위도 일반 행과 같은 30px, 데스크톱에서만 36px로 강조
  const sizeClass = featured ? "size-[30px] sm:size-9" : "size-[30px]";
  const avatarUrl = trustedAvatarUrl(entry.avatarUrl);

  if (avatarUrl) {
    return (
      <Image
        src={avatarUrl}
        alt=""
        width={36}
        height={36}
        className={`shrink-0 rounded-full object-cover ${sizeClass}`}
      />
    );
  }

  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-token-green to-code-blue text-[13px] font-black text-white ${sizeClass}`}
    >
      {entry.displayName.trim().charAt(0).toUpperCase() || "T"}
    </span>
  );
}

function RankMark({ rank }: { rank: number }) {
  if (rank === 1) {
    // 모바일에서는 일반 순위 배지(36px)와 같은 크기, 데스크톱에서만 크게
    return (
      <span
        className="grid size-9 place-items-center sm:size-[58px]"
        aria-label="1위"
      >
        <Image
          src="/assets/rank-one-crown.png"
          alt=""
          width={58}
          height={58}
          className="size-9 object-contain sm:size-[58px]"
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

  // 바로 윗 순위와의 토큰 차이 (1위이거나 데이터가 없으면 표시하지 않음)
  const viewerRank = viewerRanking?.rankPosition ?? null;
  const viewerEntry =
    viewerRank !== null
      ? (entries.find((entry) => entry.rank === viewerRank) ?? null)
      : null;
  const nextEntry =
    viewerRank !== null && viewerRank > 1
      ? (entries.find((entry) => entry.rank === viewerRank - 1) ?? null)
      : null;
  const nextRankGapLabel =
    viewerEntry && nextEntry
      ? {
          title: `${nextEntry.rank}위까지`,
          value: `${formatTokenAmount(
            Math.max(
              0,
              nextEntry.claudeTokens +
                nextEntry.codexTokens -
                viewerEntry.claudeTokens -
                viewerEntry.codexTokens,
            ),
          )} 남음`,
        }
      : null;

  return (
    <div
      className={
        viewer
          ? "grid gap-5 lg:grid-cols-[minmax(0,2.6fr)_minmax(300px,0.88fr)]"
          : "grid gap-5"
      }
    >
      <article className="rounded-lg border border-border bg-surface p-5 shadow-[0_18px_45px_rgba(29,45,37,0.08)]">
        <div className="mb-5">
          <div className="flex items-center justify-between gap-4">
            <p className="text-sm font-extrabold text-token-green">랭킹</p>
            <span
              className="group relative inline-flex min-h-8 shrink-0 cursor-help items-center rounded-full border border-badge-gold/30 bg-[#fff0c2] px-3 text-xs font-extrabold text-[#9a6400] focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
              tabIndex={0}
            >
              이번 주 Top 10
              <span className="pointer-events-none absolute right-0 top-full z-10 mt-2 hidden whitespace-nowrap rounded-lg bg-foreground px-3.5 py-2.5 text-left text-xs font-bold leading-6 text-white shadow-[0_10px_26px_rgba(29,45,37,0.28)] group-hover:block group-focus-visible:block">
                <span className="font-extrabold text-[#7ee2a8]">
                  이번 주 집계 (KST)
                </span>
                <br />
                {currentKoreaWeekRangeLabel()}
              </span>
            </span>
          </div>
          <h1 className="mt-2 text-3xl font-black tracking-normal sm:text-4xl">
            Global weekly
          </h1>
          <div className="mt-2.5 flex justify-end gap-4 text-[11px] font-bold text-muted">
            <span className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ background: CLAUDE_COLOR }}
              />
              Claude
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="size-2 rounded-full"
                style={{ background: CODEX_COLOR }}
              />
              Codex
            </span>
          </div>
        </div>

        {entries.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {entries.map((entry) => {
              const featured = entry.rank === 1;

              return (
                <article
                  key={entry.rank}
                  className={
                    featured
                      ? "rounded-lg border border-badge-gold/40 bg-gradient-to-r from-badge-gold/15 to-white p-3 shadow-[0_16px_34px_rgba(119,82,13,0.12)] sm:p-4"
                      : "rounded-lg border border-border bg-background p-3"
                  }
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <RankMark rank={entry.rank} />
                    <EntryAvatar entry={entry} featured={featured} />
                    <p
                      className={
                        featured
                          ? "min-w-0 flex-1 truncate text-sm font-extrabold sm:text-lg sm:font-black"
                          : "min-w-0 flex-1 truncate text-sm font-extrabold"
                      }
                    >
                      {entry.displayName}
                    </p>
                    <span className="ml-auto shrink-0 font-mono text-sm font-black sm:hidden">
                      {entry.scoreLabel}
                    </span>
                    <ProviderScorePill
                      claudeTokens={entry.claudeTokens}
                      codexTokens={entry.codexTokens}
                      scoreLabel={entry.scoreLabel}
                      featured={featured}
                    />
                  </div>
                  <ProviderShareBar
                    claudeTokens={entry.claudeTokens}
                    codexTokens={entry.codexTokens}
                  />
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background p-6">
            <p className="text-lg font-black">
              아직 공개 랭킹 데이터가 없습니다.
            </p>
            <p className="mt-2 text-sm font-bold leading-6 text-muted">
              실제 사용량 업로드와 랭킹 집계가 들어오면 이 영역에 공개 opt-in
              사용자만 표시됩니다.
            </p>
          </div>
        )}
      </article>

      {viewer ? (
        <aside className="grid content-start gap-4">
          <div className="rounded-lg border border-border bg-surface p-5">
            <p className="text-xs font-extrabold text-muted">내 순위</p>
            {viewerRanking?.rankPosition ? (
              <p className="mt-1 font-mono text-4xl font-black">
                #{viewerRanking.rankPosition}
              </p>
            ) : (
              <p className="mt-2 text-sm font-bold text-muted">
                {viewerStatusLabel}
              </p>
            )}

            <dl className="mt-4">
              <div className="flex items-center justify-between border-t border-border py-2.5">
                <dt className="text-sm font-bold text-muted">주간 토큰</dt>
                <dd className="font-mono text-sm font-black">
                  {viewerScoreLabel}
                </dd>
              </div>
              {nextRankGapLabel ? (
                <div className="flex items-center justify-between border-t border-border py-2.5">
                  <dt className="text-sm font-bold text-muted">
                    {nextRankGapLabel.title}
                  </dt>
                  <dd className="font-mono text-sm font-black">
                    {nextRankGapLabel.value}
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between border-t border-border py-2.5">
                <dt className="text-sm font-bold text-muted">보유 배지</dt>
                <dd className="text-sm font-black">{viewerBadges.length}개</dd>
              </div>
            </dl>
            {!viewerRanking?.rankPosition ? (
              <p className="mt-2 text-xs font-bold leading-5 text-muted">
                {viewerHelperLabel}
              </p>
            ) : null}

            <div className="mt-4">
              {sharePath ? (
                <CopyLinkButton url={sharePath} />
              ) : (
                <CreateShareLinkButton />
              )}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

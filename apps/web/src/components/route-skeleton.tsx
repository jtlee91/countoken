import type { ReactNode } from "react";

function SkeletonBlock({ className }: { className: string }) {
  return (
    <div
      className={`animate-pulse rounded-md border border-border bg-surface-alt ${className}`}
    />
  );
}

function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-border bg-surface p-5 ${className}`}>
      {children}
    </div>
  );
}

// SiteShell 헤더와 같은 3열 그리드(로고 / 중앙 탭 / 우측 프로필)를 유지해
// 로드 완료 시 요소가 점프하지 않도록 한다
function HeaderSkeleton() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto grid min-h-[72px] w-full max-w-7xl grid-cols-1 items-center gap-3 px-4 py-3 sm:px-6 md:grid-cols-[auto_1fr_auto] lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <SkeletonBlock className="size-[52px] rounded-xl" />
          <SkeletonBlock className="h-6 w-28" />
        </div>
        <div className="flex min-w-0 justify-start gap-2 p-0.5 md:justify-center">
          <SkeletonBlock className="h-10 w-[68px]" />
          <SkeletonBlock className="h-10 w-[68px]" />
        </div>
        <div className="flex items-center justify-start gap-2 md:justify-end">
          <SkeletonBlock className="h-10 w-[132px]" />
          <SkeletonBlock className="h-10 w-11" />
        </div>
      </div>
    </header>
  );
}

// 랭킹: 좌측 리스트 카드 + 우측 사이드 카드 2단 그리드
function RankingSkeleton() {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,2.6fr)_minmax(300px,0.88fr)]">
      <Card>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <SkeletonBlock className="h-4 w-12" />
            <SkeletonBlock className="mt-2 h-10 w-64" />
          </div>
          <SkeletonBlock className="h-8 w-28 rounded-full" />
        </div>
        <div className="grid gap-3">
          <SkeletonBlock className="min-h-[94px] rounded-lg" />
          <SkeletonBlock className="h-[70px] rounded-lg" />
          <SkeletonBlock className="h-[70px] rounded-lg" />
          <SkeletonBlock className="h-[70px] rounded-lg" />
        </div>
      </Card>
      <aside className="grid content-start gap-4">
        <Card>
          <SkeletonBlock className="h-3 w-14" />
          <SkeletonBlock className="mt-2 h-10 w-20" />
          <SkeletonBlock className="mt-4 h-4 w-full" />
          <SkeletonBlock className="mt-2 h-4 w-full" />
          <SkeletonBlock className="mt-2 h-4 w-2/3" />
        </Card>
        <Card>
          <SkeletonBlock className="h-3 w-14" />
          <SkeletonBlock className="mt-3 h-11 w-full" />
        </Card>
      </aside>
    </div>
  );
}

// 대시보드: 히어로 카드(제목 + 4열 지표 + 차트) + 하단 2단 그리드
function DashboardSkeleton() {
  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 px-6 pt-6">
          <div>
            <SkeletonBlock className="h-4 w-32" />
            <SkeletonBlock className="mt-2 h-8 w-72" />
          </div>
          <SkeletonBlock className="h-4 w-24" />
        </div>
        <div className="grid grid-cols-1 gap-0 px-6 pb-2 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div
              key={index}
              className={
                index === 0
                  ? "py-2 sm:pr-5"
                  : "border-t border-border py-2 sm:border-l sm:border-t-0 sm:px-5"
              }
            >
              <SkeletonBlock className="h-3 w-16" />
              <SkeletonBlock className="mt-2 h-9 w-28" />
              <SkeletonBlock className="mt-2 h-3 w-20" />
            </div>
          ))}
        </div>
        <div className="px-6 pb-6 pt-2">
          <SkeletonBlock className="h-48 w-full" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <SkeletonBlock className="h-6 w-36" />
            <SkeletonBlock className="h-7 w-24 rounded-full" />
          </div>
          <SkeletonBlock className="h-14 w-full" />
          <SkeletonBlock className="mt-3 h-14 w-full" />
        </Card>
        <Card>
          <SkeletonBlock className="h-6 w-28" />
          <SkeletonBlock className="mt-4 h-16 w-full" />
          <SkeletonBlock className="mt-3 h-16 w-full" />
          <SkeletonBlock className="mt-3 h-16 w-full" />
        </Card>
      </div>
    </div>
  );
}

// 배지: 제목 + 4열 배지 카드 그리드
function BadgesSkeleton() {
  return (
    <div className="space-y-5">
      <Card>
        <SkeletonBlock className="h-4 w-12" />
        <SkeletonBlock className="mt-2 h-9 w-56" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            <SkeletonBlock key={index} className="h-36 rounded-lg" />
          ))}
        </div>
      </Card>
    </div>
  );
}

// 설치/설정: 제목 + 본문 섹션 카드들
function ArticleSkeleton() {
  return (
    <div className="space-y-5">
      <Card>
        <SkeletonBlock className="h-9 w-56" />
        <SkeletonBlock className="mt-4 h-4 w-3/4" />
        <SkeletonBlock className="mt-2 h-4 w-2/3" />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="mt-4 h-12 w-full" />
          <SkeletonBlock className="mt-3 h-12 w-full" />
        </Card>
        <Card>
          <SkeletonBlock className="h-6 w-36" />
          <SkeletonBlock className="mt-4 h-12 w-full" />
          <SkeletonBlock className="mt-3 h-12 w-full" />
        </Card>
      </div>
    </div>
  );
}

// 공유 카드: 중앙 정렬 단일 카드
function ShareSkeleton() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="rounded-lg border border-border bg-surface">
        <div className="grid gap-6 p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div>
              <SkeletonBlock className="h-4 w-24" />
              <SkeletonBlock className="mt-2 h-9 w-48" />
            </div>
            <SkeletonBlock className="h-12 w-28" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <SkeletonBlock className="h-24 w-full" />
            <SkeletonBlock className="h-24 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}

const variants = {
  ranking: RankingSkeleton,
  dashboard: DashboardSkeleton,
  badges: BadgesSkeleton,
  article: ArticleSkeleton,
  share: ShareSkeleton,
} as const;

export function RouteSkeleton({
  variant = "article",
}: {
  variant?: keyof typeof variants;
}) {
  const Content = variants[variant];

  return (
    <div className="min-h-screen text-foreground">
      <HeaderSkeleton />
      <main
        className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
        aria-busy="true"
        aria-label="페이지를 불러오는 중"
      >
        <Content />
      </main>
    </div>
  );
}

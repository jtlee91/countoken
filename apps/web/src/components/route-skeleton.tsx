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
      <div className="mx-auto grid min-h-14 w-full max-w-7xl grid-cols-[auto_1fr_auto] items-center gap-2 px-3 py-2 sm:px-6 md:min-h-[72px] md:gap-3 md:py-3 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <SkeletonBlock className="size-9 rounded-xl md:size-[52px]" />
          <SkeletonBlock className="hidden h-6 w-28 md:block" />
        </div>
        <div className="flex min-w-0 justify-center gap-2 p-0.5">
          <SkeletonBlock className="h-10 w-[64px] md:w-[68px]" />
          <SkeletonBlock className="h-10 w-[64px] md:w-[68px]" />
        </div>
        <div className="flex items-center justify-end gap-2">
          <SkeletonBlock className="size-9 rounded-full md:h-10 md:w-[132px] md:rounded-md" />
          <SkeletonBlock className="hidden h-10 w-11 md:block" />
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

// 배지: 제목+달성도 히어로 카드 → 섹션 라벨 → 4열 배지 카드 그리드
function BadgesSkeleton() {
  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-8">
        <div>
          <SkeletonBlock className="h-4 w-24" />
          <SkeletonBlock className="mt-2 h-10 w-80 max-w-full" />
          <SkeletonBlock className="mt-3 h-4 w-96 max-w-full" />
        </div>
        <div className="w-full max-w-xs">
          <div className="flex items-center justify-between">
            <SkeletonBlock className="h-4 w-24" />
            <SkeletonBlock className="h-4 w-16" />
          </div>
          <SkeletonBlock className="mt-2 h-2.5 w-full rounded-full" />
        </div>
      </Card>
      <section>
        <SkeletonBlock className="h-6 w-28" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            <div
              key={index}
              className="rounded-lg border border-border bg-surface p-5"
            >
              <div className="flex items-start justify-between">
                <SkeletonBlock className="size-[62px] rounded-full" />
                <SkeletonBlock className="h-7 w-14 rounded-full" />
              </div>
              <SkeletonBlock className="mt-5 h-6 w-24" />
              <SkeletonBlock className="mt-3 h-4 w-full" />
              <SkeletonBlock className="mt-2 h-4 w-2/3" />
              <SkeletonBlock className="mt-4 h-11 w-full" />
              <SkeletonBlock className="mt-3 h-4 w-28" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// 설치: 제목+3단계 스텝 카드 + 어두운 코드 블록
function InstallSkeleton() {
  return (
    <div className="space-y-6">
      <Card className="p-8">
        <SkeletonBlock className="h-10 w-96 max-w-full" />
        <SkeletonBlock className="mt-4 h-4 w-3/4" />
        <div className="mt-7 grid gap-6">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="grid grid-cols-[44px_minmax(0,1fr)] gap-4"
            >
              <SkeletonBlock className="size-8 rounded-full" />
              <div>
                <SkeletonBlock className="h-5 w-40" />
                <SkeletonBlock className="mt-2 h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <div className="animate-pulse rounded-lg bg-foreground/85 p-5">
        <div className="flex items-center justify-between">
          <div className="h-4 w-32 rounded bg-white/15" />
          <div className="h-9 w-28 rounded-md bg-white/15" />
        </div>
        <div className="mt-6 h-4 w-2/3 rounded bg-white/10" />
        <div className="mt-3 h-4 w-1/2 rounded bg-white/10" />
        <div className="mt-3 h-4 w-3/5 rounded bg-white/10" />
        <div className="mt-3 h-4 w-2/5 rounded bg-white/10" />
      </div>
    </div>
  );
}

// MyPageShell과 같은 좌측 탭 메뉴 + 본문 2단 그리드
function MyPageFrame({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
      <aside className="self-start rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-2">
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-10 w-full" />
          <SkeletonBlock className="h-10 w-full" />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

// 설정: 히어로 카드 + (좌) 프로필 폼 / (우) 연결된 기기 2단 그리드
function SettingsSkeleton() {
  return (
    <div className="space-y-5">
      <Card>
        <SkeletonBlock className="h-4 w-24" />
        <SkeletonBlock className="mt-2 h-10 w-72 max-w-full" />
        <SkeletonBlock className="mt-3 h-4 w-96 max-w-full" />
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SkeletonBlock className="h-6 w-20" />
          <SkeletonBlock className="mt-6 h-4 w-14" />
          <SkeletonBlock className="mt-2 h-14 w-full" />
          <SkeletonBlock className="mt-4 h-20 w-full" />
          <SkeletonBlock className="mt-5 h-11 w-24" />
        </Card>
        <Card>
          <SkeletonBlock className="h-6 w-32" />
          <SkeletonBlock className="mt-6 h-20 w-full" />
          <SkeletonBlock className="mt-4 h-20 w-full" />
          <SkeletonBlock className="mt-4 h-4 w-2/3" />
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
  install: InstallSkeleton,
  dashboard: DashboardSkeleton,
  badges: BadgesSkeleton,
  settings: SettingsSkeleton,
  share: ShareSkeleton,
  "me-dashboard": () => (
    <MyPageFrame>
      <DashboardSkeleton />
    </MyPageFrame>
  ),
  "me-badges": () => (
    <MyPageFrame>
      <BadgesSkeleton />
    </MyPageFrame>
  ),
  "me-settings": () => (
    <MyPageFrame>
      <SettingsSkeleton />
    </MyPageFrame>
  ),
} as const;

export function RouteSkeleton({
  variant = "settings",
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

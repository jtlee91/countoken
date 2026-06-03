import {
  BarChart3,
  ShieldCheck,
  TerminalSquare,
  Trophy,
} from "lucide-react";
import Link from "next/link";

const publicStates = ["오늘 공개 사용량", "이번 주 활성 턴", "공개 랭킹", "공개 배지"];

export function PublicDashboard() {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-token-green">
                공개 Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-bold text-foreground">
                실제 공개 데이터를 기다리고 있습니다.
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
                공개 집계와 랭킹은 Supabase에 실제 사용량과 opt-in 데이터가
                들어온 뒤 표시됩니다. 개인 사용량과 설치 credential은 로그인
                후에만 열립니다.
              </p>
            </div>
            <Link
              href="/install"
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-token-green px-4 text-sm font-bold text-white hover:bg-[#137c45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
            >
              <TerminalSquare size={17} aria-hidden="true" />
              Install
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {publicStates.map((label) => (
              <article
                key={label}
                className="rounded-lg border border-border bg-background p-4"
              >
                <div className="mb-4 inline-flex rounded-md border border-border bg-surface px-2 py-1 text-xs font-bold text-muted">
                  waiting
                </div>
                <div className="font-mono text-3xl font-bold">
                  -
                </div>
                <div className="mt-1 text-sm font-semibold text-muted">
                  실제 데이터 없음
                </div>
                <p className="mt-3 text-sm font-semibold">{label}</p>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-token-green" size={22} />
            <h2 className="text-lg font-bold">저장하지 않는 데이터</h2>
          </div>
          <div className="mt-4 grid gap-2 text-sm font-semibold text-muted">
            {[
              "prompt / response",
              "cwd / transcript_path",
              "raw JSON line",
              "파일 경로 / 프로젝트명",
              "git 정보 / 인증 토큰",
            ].map((item) => (
              <div
                key={item}
                className="rounded-md border border-border bg-background px-3 py-2"
              >
                {item}
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="text-code-blue" size={22} />
            <h2 className="text-lg font-bold">에이전트 사용 흐름</h2>
          </div>
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-semibold leading-6 text-muted">
            아직 공개 가능한 에이전트 사용 집계가 없습니다. 실제 업로드 후
            집계 데이터만 표시됩니다.
          </p>
        </article>

        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <TerminalSquare className="text-warm-amber" size={22} />
            <h2 className="text-lg font-bold">공개 인사이트</h2>
          </div>
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-semibold leading-6 text-muted">
            아직 공개 인사이트가 없습니다. 실제 사용량 요약이 쌓인 뒤 개인정보
            없이 집계된 내용만 표시됩니다.
          </p>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Trophy className="text-badge-gold" size={22} />
            <h2 className="text-lg font-bold">주간 공개 랭킹</h2>
          </div>
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-semibold leading-6 text-muted">
            아직 공개 랭킹 row가 없습니다. opt-in 사용자와 실제 주간 점수가
            생성되면 이 영역에 표시됩니다.
          </p>
        </article>

        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="text-token-green" size={22} />
            <h2 className="text-lg font-bold">공개 뱃지</h2>
          </div>
          <p className="rounded-md border border-dashed border-border bg-background p-4 text-sm font-semibold leading-6 text-muted">
            아직 공개 가능한 배지 획득 내역이 없습니다. 실제 사용자 배지
            데이터만 표시됩니다.
          </p>
        </article>
      </section>
    </div>
  );
}

import { LockKeyhole, ShieldCheck } from "lucide-react";
import Link from "next/link";

const gatedItems = [
  "개인 오늘 사용량",
  "개인화 설치문",
  "기기 연결 상태",
  "랭킹 공개 설정",
];

export function LoginRequired({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-4 inline-flex size-11 items-center justify-center rounded-md bg-warm-amber/10 text-warm-amber">
            <LockKeyhole size={24} aria-hidden="true" />
          </div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
            {description}
          </p>
          <Link
            href="/login"
            className="mt-5 inline-flex min-h-10 items-center gap-2 rounded-md bg-token-green px-4 text-sm font-bold text-white hover:bg-[#137c45] focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
          >
            <ShieldCheck size={17} aria-hidden="true" />
            로그인 필요
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {gatedItems.map((item) => (
            <div
              key={item}
              className="rounded-lg border border-border bg-background p-4"
            >
              <p className="text-sm font-bold">{item}</p>
              <p className="mt-2 text-sm leading-6 text-muted">
                인증 후 본인 데이터만 표시됩니다.
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

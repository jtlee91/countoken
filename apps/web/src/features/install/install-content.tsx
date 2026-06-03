import {
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  ShieldCheck,
  TerminalSquare,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";

import { MacbookInstallGenerator } from "@/features/install/codex-install-generator";
import type { ViewerProfile } from "@/lib/data/models";

const agents = [
  {
    name: "Claude Code",
    type: "claude_code",
    support: "공식 지원",
    trigger: "SessionStart + Stop hook",
    wrapper: "token-plane-claude-code.sh",
    status: "설치 프롬프트 생성 가능",
    tone: "green",
  },
  {
    name: "Codex",
    type: "codex",
    support: "공식 지원",
    trigger: "SessionStart + Stop hook",
    wrapper: "token-plane-codex.sh",
    status: "설치 프롬프트 생성 가능",
    tone: "blue",
  },
  {
    name: "Opencode",
    type: "opencode",
    support: "베타 준비 중",
    trigger: "message.updated + session.idle plugin event",
    wrapper: "token-plane.sh / token-plane.ps1",
    status: "preparing",
    tone: "amber",
  },
];

const safeFields = [
  "agent_type",
  "anonymized_session_id",
  "turn_started_at / turn_completed_at",
  "timezone",
  "input_tokens / output_tokens",
  "cache",
  "message_count",
  "collector_version",
  "event_fingerprint",
];

function badgeClass(tone: string) {
  if (tone === "green") {
    return "border-token-green/30 bg-token-green/10 text-token-green";
  }

  if (tone === "blue") {
    return "border-code-blue/30 bg-code-blue/10 text-code-blue";
  }

  return "border-warm-amber/30 bg-warm-amber/10 text-warm-amber";
}

export function InstallContent({ viewer }: { viewer?: ViewerProfile | null }) {
  return (
    <div className="space-y-6">
      <section className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-code-blue">
                공개 Install
              </p>
              <h1 className="mt-2 text-3xl font-bold">
                에이전트가 설치하는 흐름입니다.
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
                Claude Code와 Codex에 붙여넣을 설치 프롬프트를 생성합니다. 사용자가
                직접 명령어를 옮겨 실행하지 않고 코드 에이전트가 로컬 설치와 설정
                병합을 처리합니다.
              </p>
            </div>
            <Link
              href={viewer ? "/me/settings" : "/login"}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-code-blue px-4 text-sm font-bold text-white hover:bg-[#1d4ed8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-token-green"
            >
              <KeyRound size={17} aria-hidden="true" />
              {viewer ? "개인화 준비" : "로그인 후 개인화"}
            </Link>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            {agents.map((agent) => (
              <article
                key={agent.type}
                className="rounded-lg border border-border bg-background p-4"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <TerminalSquare className="text-code-blue" size={24} />
                  <span
                    className={`rounded-md border px-2 py-1 text-xs font-bold ${badgeClass(agent.tone)}`}
                  >
                    {agent.support}
                  </span>
                </div>
                <h2 className="text-lg font-bold">{agent.name}</h2>
                <dl className="mt-4 grid gap-3 text-sm">
                  <div>
                    <dt className="font-semibold text-muted">자동 실행 지점</dt>
                    <dd className="mt-1 font-semibold">{agent.trigger}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-muted">wrapper</dt>
                    <dd className="mt-1 font-mono text-xs font-semibold">
                      {agent.wrapper}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-muted">상태</dt>
                    <dd className="mt-1 font-semibold">{agent.status}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        </div>

        <aside className="rounded-lg border border-border bg-surface p-5">
          <div className="flex items-center gap-2">
            <Lock className="text-warm-amber" size={22} />
            <h2 className="text-lg font-bold">로그인 후 열리는 영역</h2>
          </div>
          <div className="mt-4 grid gap-3">
            {[
              "Claude Code 설치 프롬프트",
              "Codex 설치 프롬프트",
              "device UUID",
              "write-only ingest credential",
              "설정과 연결 해제",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm font-semibold"
              >
                <CheckCircle2
                  className="shrink-0 text-token-green"
                  size={17}
                  aria-hidden="true"
                />
                {item}
              </div>
            ))}
          </div>
        </aside>
      </section>

      {viewer ? (
        <MacbookInstallGenerator />
      ) : (
        <section className="rounded-lg border border-border bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-extrabold text-code-blue">
                Claude Code + Codex
              </p>
              <h2 className="mt-1 text-2xl font-black">
                설치 프롬프트는 로그인 후 생성됩니다.
              </h2>
              <p className="mt-2 text-sm font-semibold leading-6 text-muted">
                device UUID, write-only ingest credential, local HMAC secret은
                계정 세션이 확인된 뒤에만 발급됩니다.
              </p>
            </div>
            <Link
              href="/login"
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-code-blue px-4 text-sm font-bold text-white hover:bg-[#1d4ed8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-token-green"
            >
              <KeyRound size={17} aria-hidden="true" />
              로그인
            </Link>
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <Copy className="text-code-blue" size={22} />
            <h2 className="text-lg font-bold">일반 wrapper 흐름</h2>
          </div>
          <pre className="overflow-x-auto rounded-lg border border-border bg-[#101a14] p-4 font-mono text-sm leading-7 text-white">
            <code>{`agent hook/statusLine/plugin
-> thin OS wrapper
-> portable local collector
-> local SQLite outbox
-> sync uploader`}</code>
          </pre>
          <p className="mt-4 text-sm leading-6 text-muted">
            wrapper는 복잡한 파싱을 하지 않고 collector와 sync uploader만
            호출합니다. sync 재시도는 다음 agent lifecycle에서만 실행됩니다.
          </p>
        </article>

        <article className="rounded-lg border border-border bg-surface p-5">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="text-token-green" size={22} />
            <h2 className="text-lg font-bold">허용 upload 필드</h2>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {safeFields.map((field) => (
              <div
                key={field}
                className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs font-semibold"
              >
                {field}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="rounded-lg border border-alert-red/30 bg-alert-red/5 p-5">
        <div className="flex items-start gap-3">
          <TriangleAlert
            className="mt-1 shrink-0 text-alert-red"
            size={22}
            aria-hidden="true"
          />
          <div>
            <h2 className="text-lg font-bold">업로드 중단 조건</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              prompt, response, cwd, transcript_path, raw JSON line, 파일 경로,
              프로젝트명, git 정보, API key, OAuth token이 payload에 섞이면
              저장하지 않습니다.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

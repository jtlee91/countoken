import {
  ClipboardPaste,
  Globe,
  ShieldCheck,
  TerminalSquare,
} from "lucide-react";

import { CopyPromptButton } from "@/features/install/copy-prompt-button";
import { getSiteUrl } from "@/lib/env";

const BIN_PATH = "~/.mylocalagenttoken/bin/token-agent";

function buildInstallPrompt(siteUrl: string) {
  return `Install the Token Plane local token usage tracker on this machine. Follow these steps in order.

1. Run the install script:
   curl -fsSL ${siteUrl}/install.sh | bash
   This installs the token-agent binary and hook script under ~/.mylocalagenttoken, and registers a Stop hook for Claude Code (~/.claude/settings.json) and Codex (~/.codex/config.toml). Existing settings are preserved via merge, and re-running is idempotent.

2. Log in (run with a command timeout of at least 6 minutes):
   ${BIN_PATH} login
   This command opens a browser automatically and blocks until login completes. When you start it, tell me to complete the Google login in the browser. If the browser does not open, show me the URL the command printed.

3. Verify the install:
   ${BIN_PATH} inspect --quiet && ${BIN_PATH} sync --quiet
   If both succeed, report "install complete" with a short summary of the device info printed by the login step.

Important: never print or store the contents of ~/.mylocalagenttoken/auth.json, access tokens, or any other secret values.`;
}

const steps = [
  {
    icon: ClipboardPaste,
    title: "1. 프롬프트 복사 & 붙여넣기",
    description:
      "아래 설치 프롬프트를 복사해서 Claude Code 또는 Codex에 붙여넣으세요. 에이전트가 다운로드부터 훅 등록까지 전부 처리합니다.",
  },
  {
    icon: Globe,
    title: "2. Google 로그인",
    description:
      "설치 중 브라우저가 자동으로 열립니다. Google 계정으로 로그인하면 이 기기가 내 계정에 연결됩니다.",
  },
  {
    icon: TerminalSquare,
    title: "3. 끝. 자동 동기화",
    description:
      "이후 에이전트 응답이 끝날 때마다 토큰 사용량이 자동으로 수집·동기화됩니다. 대시보드에서 바로 확인하세요.",
  },
];

const privacyPoints = [
  "프롬프트·응답 원문, 프로젝트 경로 등은 수집하지 않습니다. 토큰 수와 세션 메타데이터만 동기화됩니다.",
  "세션 단위 상세 데이터는 로컬 SQLite(~/.mylocalagenttoken)에만 저장됩니다.",
  "기존 Claude Code / Codex 설정은 병합 방식으로 보존됩니다.",
];

export function InstallContent() {
  const siteUrl = getSiteUrl().replace(/\/$/, "");
  const prompt = buildInstallPrompt(siteUrl);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-6">
        <p className="text-sm font-semibold text-code-blue">Install</p>
        <h1 className="mt-2 text-3xl font-bold">
          프롬프트 한 번이면 설치 끝.
        </h1>
        <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-muted">
          코드 에이전트에게 설치를 맡기세요. 복사한 프롬프트를 붙여넣으면
          에이전트가 설치하고, Google 로그인 한 번으로 연결이 완료됩니다.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.title}
              className="rounded-md border border-border bg-background p-4"
            >
              <step.icon className="h-5 w-5 text-token-green" />
              <p className="mt-3 text-sm font-black">{step.title}</p>
              <p className="mt-2 text-xs font-bold leading-5 text-muted">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black">설치 프롬프트</h2>
            <p className="mt-1 text-sm font-bold text-muted">
              Claude Code와 Codex 어느 쪽에 붙여넣어도 두 에이전트 모두
              설정됩니다.
            </p>
          </div>
          <CopyPromptButton text={prompt} />
        </div>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-md border border-border bg-background p-4 font-mono text-xs font-bold leading-6 text-foreground">
          {prompt}
        </pre>
      </section>

      <section className="rounded-lg border border-border bg-surface p-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-token-green" />
          <h2 className="text-xl font-black">무엇이 수집되나요?</h2>
        </div>
        <ul className="mt-4 space-y-2">
          {privacyPoints.map((point) => (
            <li
              key={point}
              className="flex items-start gap-2 text-sm font-bold leading-6 text-muted"
            >
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-token-green" />
              {point}
            </li>
          ))}
        </ul>
        <p className="mt-4 rounded-md border border-dashed border-border bg-background p-3 text-xs font-bold leading-5 text-muted">
          터미널에서 직접 설치하려면:{" "}
          <code className="font-mono">
            curl -fsSL {siteUrl}/install.sh | bash && {BIN_PATH} login
          </code>
        </p>
      </section>
    </div>
  );
}

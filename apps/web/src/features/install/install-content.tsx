import { ShieldCheck } from "lucide-react";

import { CopyPromptButton } from "@/features/install/copy-prompt-button";
import { ExpandablePrompt } from "@/features/install/expandable-prompt";
import { getSiteUrl } from "@/lib/env";

const BIN_PATH = "~/.countoken/bin/token-agent";

function buildInstallPrompt(siteUrl: string) {
  return `Install the Token Plane local token usage tracker on this machine. Follow these steps in order.

1. Run the install script:
   curl -fsSL ${siteUrl}/install.sh | bash
   This installs the token-agent binary and hook script under ~/.countoken, and registers a Stop hook for Claude Code (~/.claude/settings.json) and Codex (~/.codex/config.toml). Existing settings are preserved via merge, and re-running is idempotent.

2. Log in (run with a command timeout of at least 6 minutes):
   ${BIN_PATH} login
   This command opens a browser automatically and blocks until login completes. When you start it, tell me to complete the Google login in the browser. If the browser does not open, show me the URL the command printed.

3. Verify the install:
   ${BIN_PATH} inspect --quiet && ${BIN_PATH} sync --quiet
   If both succeed, report "install complete" with a short summary of the device info printed by the login step.

4. Open the dashboard:
   Open ${siteUrl}/ in the browser (e.g. \`open ${siteUrl}/\` on macOS or \`xdg-open ${siteUrl}/\` on Linux) so I can see my synced token usage right away.

Important: never print or store the contents of ~/.countoken/auth.json, access tokens, or any other secret values.`;
}

const steps = [
  {
    title: "프롬프트 복사 & 붙여넣기",
    description:
      "아래 설치 프롬프트를 복사해서 Claude Code 또는 Codex에 붙여넣으세요. 어느 쪽에 붙여넣어도 두 에이전트 모두 설정됩니다.",
  },
  {
    title: "Google 로그인",
    description:
      "설치 중 브라우저가 자동으로 열립니다. Google 계정으로 로그인하면 이 기기가 내 계정에 연결됩니다.",
  },
  {
    title: "끝. 이후는 자동 동기화",
    description:
      "에이전트 응답이 끝날 때마다 토큰 사용량이 자동으로 수집·동기화됩니다. 대시보드에서 바로 확인하세요.",
  },
];

const privacyPoints = [
  "프롬프트·응답 원문, 프로젝트 경로 등은 수집하지 않습니다. 토큰 수와 세션 메타데이터만 동기화됩니다.",
  "세션 단위 상세 데이터는 로컬 SQLite(~/.countoken)에만 저장됩니다.",
  "설치 시 기존 에이전트 설정은 그대로 유지되며, 동기화에 필요한 hook 한가지가 추가됩니다.",
];

export function InstallContent() {
  const siteUrl = getSiteUrl().replace(/\/$/, "");
  const prompt = buildInstallPrompt(siteUrl);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-3xl font-bold">
          프롬프트 한 번이면 설치 끝.
        </h1>
        <p className="mt-3 max-w-4xl text-sm font-bold leading-6 text-muted">
          코드 에이전트에게 설치를 맡기세요. 복사한 프롬프트를 붙여넣으면
          에이전트가 설치하고, Google 로그인 한 번으로 연결이 완료됩니다.
        </p>
        <ol className="mt-7 grid gap-0">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className="relative grid grid-cols-[44px_minmax(0,1fr)] gap-4 pb-6 last:pb-0"
            >
              {index < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 left-4 top-9 w-0.5 bg-token-green/20"
                />
              ) : null}
              <span className="z-10 grid size-8 place-items-center rounded-full bg-token-green text-sm font-black text-white">
                {index + 1}
              </span>
              <div>
                <p className="pt-1 text-sm font-black">{step.title}</p>
                <p className="mt-1.5 max-w-2xl text-xs font-bold leading-5 text-muted">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="overflow-hidden rounded-lg border border-[#2a2f2b]">
        <div className="flex items-center gap-1.5 bg-[#202420] px-4 py-2.5">
          <span className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
          <span className="ml-2.5 text-xs font-bold text-[#9aa39c]">
            install-prompt.txt
          </span>
          <div className="ml-auto">
            <CopyPromptButton text={prompt} />
          </div>
        </div>
        <ExpandablePrompt text={prompt} />
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

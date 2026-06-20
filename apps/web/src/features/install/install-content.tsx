import { ShieldCheck } from "lucide-react";

import { CopyPromptButton } from "@/features/install/copy-prompt-button";
import { ExpandablePrompt } from "@/features/install/expandable-prompt";
import { getSiteUrl } from "@/lib/env";

const BIN_PATH = "~/.countoken/bin/token-agent";

function buildInstallPrompt(siteUrl: string) {
  return `Install the Countoken local token usage tracker on this machine. Follow these steps in order.

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
  "설치 시 기존 에이전트 설정은 그대로 유지되며, 동기화에 필요한 hook 한가지가 추가됩니다.",
];

const TERM_CARD_STYLE = {
  background:
    "radial-gradient(900px 300px at 85% -40%, rgba(74,222,128,0.10), transparent 60%), linear-gradient(180deg, #11140f, #0a0c09)",
} as const;

const TERM_HEAD_STYLE = {
  background:
    "linear-gradient(180deg, rgba(26,30,23,0.9), rgba(20,24,18,0.9))",
} as const;

function TermDots() {
  return (
    <div className="flex gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57]" />
      <span className="size-3 rounded-full bg-[#febc2e]" />
      <span className="size-3 rounded-full bg-[#28c840]" />
    </div>
  );
}

export function InstallContent() {
  const siteUrl = getSiteUrl().replace(/\/$/, "");
  const prompt = buildInstallPrompt(siteUrl);
  const directCommand = `curl -fsSL ${siteUrl}/install.sh | bash && ${BIN_PATH} login`;

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface p-6">
        <h1 className="text-3xl font-bold">
          프롬프트 한 번이면 설치 끝.
        </h1>
        <p className="mt-3 text-sm font-bold leading-6 text-muted">
          복사한 프롬프트를 코드 에이전트에게 입력하면, 에이전트가 모든 설치
          작업을 진행합니다!
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
                <p className="mt-1.5 text-xs font-bold leading-5 text-muted">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section
        className="relative overflow-hidden rounded-2xl border border-[#2a2f26] shadow-[0_24px_60px_-28px_rgba(10,20,12,0.55)]"
        style={TERM_CARD_STYLE}
      >
        <div
          className="relative flex items-center gap-3.5 border-b border-[#2a2f26] px-4 py-3"
          style={TERM_HEAD_STYLE}
        >
          <TermDots />
          <span className="ml-1 font-mono text-[12.5px] font-bold text-[#7e887b]">
            install-prompt.txt
          </span>
          <div className="ml-auto">
            <CopyPromptButton text={prompt} label="프롬프트 복사" />
          </div>
        </div>
        <ExpandablePrompt text={prompt} />
      </section>

      <div>
        <div className="mb-2 flex items-center gap-2.5">
          <span className="text-xl font-extrabold leading-none text-token-green">
            ›
          </span>
          <h2 className="text-[22px] font-extrabold tracking-tight">
            터미널에서 직접 설치
          </h2>
        </div>
        <p className="mb-4 text-[13px] font-bold leading-relaxed text-muted">
          바이너리와 hook을 설치하고 Google 로그인 한 번이면 끝.{" "}
          <b className="text-foreground">macOS &amp; Linux</b> 지원, Windows는
          준비 중.
        </p>

        <section
          className="relative overflow-hidden rounded-2xl border border-[#2a2f26] shadow-[0_24px_60px_-28px_rgba(10,20,12,0.55)]"
          style={TERM_CARD_STYLE}
        >
          <div
            className="relative flex items-center gap-3.5 border-b border-[#2a2f26] px-4 py-3"
            style={TERM_HEAD_STYLE}
          >
            <TermDots />
            <span className="ml-1 font-mono text-[12.5px] font-bold text-[#7e887b]">
              install.sh
            </span>
            <div className="ml-auto">
              <CopyPromptButton text={directCommand} label="명령 복사" />
            </div>
          </div>
          <div className="relative flex items-start gap-2.5 px-[22px] py-[22px] font-mono text-sm leading-7">
            <span className="select-none font-bold text-[#4ade80]">$</span>
            <span className="break-words [word-break:keep-all] text-[#d4ddd0]">
              curl -fsSL{" "}
              <span className="text-[#93e6b0]">{siteUrl}/install.sh</span>{" "}
              <span className="text-[#7e887b]">|</span> bash{" "}
              <span className="text-[#7e887b]">&amp;&amp;</span> {BIN_PATH} login
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-[#2a2f26] bg-black/15 px-4 py-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#4ade80]/35 px-2.5 py-1 font-mono text-[11px] font-bold text-[#d4ddd0]">
              <span className="text-token-green">●</span> macOS &amp; Linux
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#2a2f26] px-2.5 py-1 font-mono text-[11px] font-bold text-[#5c6a58]">
              Windows · 준비 중
            </span>
          </div>
        </section>
      </div>

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
      </section>
    </div>
  );
}

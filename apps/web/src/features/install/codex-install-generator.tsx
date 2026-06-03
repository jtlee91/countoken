"use client";

import {
  Bot,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";

import {
  createMacbookInstallAction,
  type InstallPrompt,
  type MacbookInstallActionResult,
} from "@/features/install/actions";

function CopyValueButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copyValue() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyValue}
      className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-extrabold text-foreground hover:border-code-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
    >
      <Copy size={15} aria-hidden="true" />
      {copied ? "복사했습니다" : label}
    </button>
  );
}

function SecretField({
  label,
  value,
  rows = 3,
}: {
  label: string;
  value: string;
  rows?: number;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="text-xs font-extrabold text-muted">{label}</label>
        <CopyValueButton value={value} label="복사" />
      </div>
      <textarea
        readOnly
        rows={rows}
        value={value}
        className="w-full resize-y rounded-md border border-border bg-[#101a14] p-3 font-mono text-xs leading-6 text-white outline-none"
      />
    </div>
  );
}

function PromptPanel({ installPrompt }: { installPrompt: InstallPrompt }) {
  return (
    <article className="grid gap-3 rounded-lg border border-code-blue/25 bg-background p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Bot className="text-code-blue" size={20} aria-hidden="true" />
          <h3 className="text-base font-black">{installPrompt.label}</h3>
        </div>
        <CopyValueButton
          value={installPrompt.prompt}
          label={installPrompt.pasteLabel}
        />
      </div>
      <textarea
        readOnly
        rows={14}
        value={installPrompt.prompt}
        className="min-h-72 w-full resize-y rounded-md border border-border bg-[#101a14] p-3 font-mono text-xs leading-6 text-white outline-none"
      />
    </article>
  );
}

export function MacbookInstallGenerator() {
  const [result, setResult] = useState<MacbookInstallActionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      setResult(await createMacbookInstallAction(formData));
    });
  }

  return (
    <section className="rounded-lg border border-code-blue/25 bg-code-blue/5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-extrabold text-code-blue">
            Claude Code + Codex
          </p>
          <h2 className="mt-1 text-2xl font-black">에이전트 설치 프롬프트 생성</h2>
          <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted">
            명령어를 직접 실행하지 않아도 됩니다. 프롬프트를 복사해 코드
            에이전트에 붙여넣으면 설치, hook 병합, doctor 실행까지 맡깁니다.
          </p>
        </div>
        <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-token-green/30 bg-token-green/10 px-3 text-xs font-extrabold text-token-green">
          <ShieldCheck size={15} aria-hidden="true" />
          one-time credential
        </span>
      </div>

      <form onSubmit={submit} className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="grid gap-2">
          <span className="text-xs font-extrabold text-muted">기기 표시명</span>
          <input
            name="device_label"
            maxLength={60}
            placeholder="MacBook"
            className="min-h-11 rounded-md border border-border bg-background px-3 text-sm font-bold outline-none focus:border-code-blue"
          />
        </label>
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex min-h-11 items-center justify-center gap-2 self-end rounded-md bg-code-blue px-4 text-sm font-extrabold text-white hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-token-green"
        >
          {isPending ? (
            <Loader2 className="animate-spin" size={17} aria-hidden="true" />
          ) : (
            <KeyRound size={17} aria-hidden="true" />
          )}
          생성
        </button>
      </form>

      {result?.ok === false ? (
        <p className="mt-4 rounded-md border border-alert-red/30 bg-alert-red/5 px-3 py-2 text-sm font-bold text-alert-red">
          {result.safeMessage}
        </p>
      ) : null}

      {result?.ok ? (
        <div className="mt-5 grid gap-4">
          <div className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-extrabold text-muted">device_uuid</p>
              <p className="mt-1 break-all font-mono text-xs font-bold">
                {result.deviceUuid}
              </p>
            </div>
            <div>
              <p className="text-xs font-extrabold text-muted">agents</p>
              <p className="mt-1 break-all font-mono text-xs font-bold">
                {result.agentTypes.join(", ")}
              </p>
            </div>
            <div>
              <p className="text-xs font-extrabold text-muted">endpoint</p>
              <p className="mt-1 break-all font-mono text-xs font-bold">
                {result.endpoint}
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {result.installPrompts.map((installPrompt) => (
              <PromptPanel
                key={installPrompt.agentType}
                installPrompt={installPrompt}
              />
            ))}
          </div>

          <details className="rounded-lg border border-border bg-surface p-4">
            <summary className="cursor-pointer text-sm font-black text-muted">
              고급 config 보기
            </summary>
            <div className="mt-4">
              <SecretField label="config.json" value={result.configJson} rows={11} />
            </div>
          </details>

          <div className="flex items-start gap-2 rounded-md border border-token-green/30 bg-token-green/10 px-3 py-2 text-sm font-bold text-token-green">
            <CheckCircle2 className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
            <p>
              raw ingest key는 이 응답에만 표시되고 서버에는 pepper 기반 hash만
              저장됩니다. 설치 프롬프트는 raw transcript, path, prompt, response
              저장을 금지합니다.
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

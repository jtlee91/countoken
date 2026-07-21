"use client";

import { useState } from "react";

import { CopyPromptButton } from "@/features/install/copy-prompt-button";

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

type OsTab = "unix" | "windows";

export function DirectInstallCard({
  siteUrl,
  binPath,
}: {
  siteUrl: string;
  binPath: string;
}) {
  const [tab, setTab] = useState<OsTab>("unix");

  const winBin = String.raw`$env:USERPROFILE\.countoken\bin\token-agent.exe`;
  const commands: Record<OsTab, { fileName: string; copyText: string }> = {
    unix: {
      fileName: "install.sh",
      copyText: `curl -fsSL ${siteUrl}/install.sh | bash && ${binPath} login`,
    },
    windows: {
      fileName: "install.ps1",
      copyText: `irm ${siteUrl}/install.ps1 | iex; & "${winBin}" login`,
    },
  };

  const tabs: { key: OsTab; label: string }[] = [
    { key: "unix", label: "macOS & Linux" },
    { key: "windows", label: "Windows" },
  ];

  return (
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
          {commands[tab].fileName}
        </span>
        <div className="ml-auto">
          <CopyPromptButton text={commands[tab].copyText} label="명령 복사" />
        </div>
      </div>
      <div className="relative flex items-start gap-2.5 px-[22px] py-[22px] font-mono text-sm leading-7">
        {tab === "unix" ? (
          <>
            <span className="select-none font-bold text-[#4ade80]">$</span>
            <span className="break-words [word-break:keep-all] text-[#d4ddd0]">
              curl -fsSL{" "}
              <span className="text-[#93e6b0]">{siteUrl}/install.sh</span>{" "}
              <span className="text-[#7e887b]">|</span> bash{" "}
              <span className="text-[#7e887b]">&amp;&amp;</span> {binPath} login
            </span>
          </>
        ) : (
          <>
            <span className="select-none font-bold text-[#4ade80]">&gt;</span>
            <span className="break-words [word-break:keep-all] text-[#d4ddd0]">
              irm{" "}
              <span className="text-[#93e6b0]">{siteUrl}/install.ps1</span>{" "}
              <span className="text-[#7e887b]">|</span> iex
              <span className="text-[#7e887b]">;</span> &amp; &quot;{winBin}
              &quot; login
            </span>
          </>
        )}
      </div>
      <div
        role="tablist"
        aria-label="설치 OS 선택"
        className="flex flex-wrap items-center gap-2 border-t border-[#2a2f26] bg-black/15 px-4 py-2.5"
      >
        {tabs.map(({ key, label }) => {
          const selected = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTab(key)}
              className={[
                "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold transition",
                selected
                  ? "border-[#4ade80]/35 text-[#d4ddd0]"
                  : "border-[#2a2f26] text-[#5c6a58] hover:text-[#d4ddd0]",
              ].join(" ")}
            >
              {selected ? <span className="text-token-green">●</span> : null}
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

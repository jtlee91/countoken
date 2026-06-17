"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyPromptButton({
  text,
  label = "복사",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "복사됨" : label}
      aria-label={copied ? "복사됨" : label}
      className={[
        "grid size-[30px] place-items-center rounded-lg border transition",
        copied
          ? "border-[#4ade80]/50 bg-[#4ade80]/10 text-[#4ade80]"
          : "border-[#2a2f26] bg-white/[0.03] text-[#7e887b] hover:text-[#d4ddd0]",
      ].join(" ")}
    >
      {copied ? (
        <Check className="size-[15px]" strokeWidth={2.5} />
      ) : (
        <Copy className="size-[15px]" />
      )}
    </button>
  );
}

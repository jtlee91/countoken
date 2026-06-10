"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function CopyPromptButton({ text }: { text: string }) {
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
      className="inline-flex items-center gap-2 rounded-md border border-border bg-foreground px-4 py-2 text-sm font-extrabold text-white transition hover:opacity-90"
    >
      {copied ? (
        <>
          <Check className="h-4 w-4" />
          복사 완료
        </>
      ) : (
        <>
          <Copy className="h-4 w-4" />
          프롬프트 복사
        </>
      )}
    </button>
  );
}

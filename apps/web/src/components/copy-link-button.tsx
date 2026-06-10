"use client";

import { Copy } from "lucide-react";
import { useState } from "react";

export function CopyLinkButton({
  url,
  label = "공유 링크 복사",
}: {
  url: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(
        new URL(url, window.location.origin).toString(),
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <button
      type="button"
      onClick={copyUrl}
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-extrabold text-foreground hover:border-code-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue"
    >
      <Copy size={17} aria-hidden="true" />
      {copied ? "복사했습니다" : label}
    </button>
  );
}

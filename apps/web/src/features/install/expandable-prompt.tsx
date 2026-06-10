"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

export function ExpandablePrompt({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative mt-4">
      <pre
        id="install-prompt"
        className={[
          "overflow-hidden whitespace-pre-wrap rounded-md border border-border bg-background p-4 pb-14 font-mono text-xs font-bold leading-6 text-foreground transition-[max-height] duration-200",
          expanded ? "max-h-[900px] overflow-x-auto" : "max-h-32",
        ].join(" ")}
      >
        {text}
      </pre>
      {!expanded ? (
        <div className="pointer-events-none absolute inset-x-px bottom-px h-14 rounded-b-md bg-gradient-to-b from-background/0 to-background" />
      ) : null}
      <button
        type="button"
        aria-controls="install-prompt"
        aria-expanded={expanded}
        title={expanded ? "프롬프트 접기" : "전체 프롬프트 펼치기"}
        onClick={() => setExpanded((value) => !value)}
        className="absolute bottom-3 left-1/2 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm transition hover:bg-background"
      >
        <ChevronDown
          className={[
            "h-5 w-5 transition-transform",
            expanded ? "rotate-180" : "",
          ].join(" ")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

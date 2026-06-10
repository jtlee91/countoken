"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

export function ExpandablePrompt({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="relative">
      <pre
        id="install-prompt"
        className={[
          "overflow-hidden whitespace-pre-wrap bg-[#141714] px-5 py-4 font-mono text-xs font-bold leading-6 text-[#cdd6cf] transition-[max-height] duration-200",
          expanded ? "max-h-[1200px] overflow-x-auto" : "max-h-36",
        ].join(" ")}
      >
        {text}
      </pre>
      {!expanded ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-[#141714]" />
      ) : null}
      <div
        className={
          expanded
            ? "flex justify-center bg-[#141714] pb-3"
            : "absolute inset-x-0 bottom-2 flex justify-center"
        }
      >
        <button
          type="button"
          aria-controls="install-prompt"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#3a403a] bg-[#2a2f2a] px-4 py-1.5 text-xs font-extrabold text-[#cdd6cf] transition hover:bg-[#343a34]"
        >
          {expanded ? "접기" : "전체 보기"}
          <ChevronDown
            className={[
              "h-3.5 w-3.5 transition-transform",
              expanded ? "rotate-180" : "",
            ].join(" ")}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}

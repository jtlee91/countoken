"use client";

import { Link2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createShareLinkAction } from "@/features/community/share-actions";

export function CreateShareLinkButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);

  function createLink() {
    setFailed(false);
    startTransition(async () => {
      const result = await createShareLinkAction();

      if (result.ok) {
        router.refresh();
      } else {
        setFailed(true);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={createLink}
      disabled={isPending}
      className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-surface px-4 py-2 text-sm font-extrabold text-foreground hover:border-code-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-code-blue disabled:opacity-60"
    >
      <Link2 size={17} aria-hidden="true" />
      {isPending
        ? "공유 링크 만드는 중..."
        : failed
          ? "실패했습니다. 다시 시도"
          : "공유 링크 만들기"}
    </button>
  );
}

"use client";

import { useEffect, useRef } from "react";

export function InfiniteLoadTrigger({
  hasMore,
  loading,
  error,
  onLoadMore,
}: {
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const target = triggerRef.current;
    if (!target || !hasMore || loading || error) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          onLoadMore();
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [error, hasMore, loading, onLoadMore]);

  if (!hasMore && !loading && !error) {
    return null;
  }

  return (
    <div ref={triggerRef} className="flex justify-center py-3 text-xs font-bold">
      {error ? (
        <button
          type="button"
          onClick={onLoadMore}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-foreground"
        >
          다시 불러오기
        </button>
      ) : (
        <span className="text-muted">
          {loading ? "불러오는 중…" : "스크롤하면 더 불러옵니다"}
        </span>
      )}
    </div>
  );
}

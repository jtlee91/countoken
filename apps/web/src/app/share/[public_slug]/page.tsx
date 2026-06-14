import { notFound } from "next/navigation";

import { SiteShell } from "@/components/site-shell";
import { ShareCardContent } from "@/features/share/share-card-content";
import { getShareCard } from "@/lib/data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ public_slug: string }>;
}) {
  const { public_slug: publicSlug } = await params;
  const card = await getShareCard(publicSlug);

  if (!card) {
    return { title: "Countoken" };
  }

  return {
    title: `${card.displayName}의 주간 토큰 리포트 | Countoken`,
    description: card.rankPosition
      ? `이번 주 글로벌 ${card.rankPosition}위 · ${card.scoreLabel ?? ""} tokens`
      : "Countoken 주간 사용량 공유 카드",
  };
}

export default async function SharePage({
  params,
}: {
  params: Promise<{ public_slug: string }>;
}) {
  const { public_slug: publicSlug } = await params;
  const card = await getShareCard(publicSlug);

  if (!card) {
    notFound();
  }

  return (
    <SiteShell activePath="/ranking">
      <ShareCardContent card={card} />
    </SiteShell>
  );
}

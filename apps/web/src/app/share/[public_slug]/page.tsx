import { notFound } from "next/navigation";

import { SiteShell } from "@/components/site-shell";
import { ShareCardContent } from "@/features/share/share-card-content";
import { getShareCard } from "@/lib/data";

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

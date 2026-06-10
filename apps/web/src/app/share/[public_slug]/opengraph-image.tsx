import { ImageResponse } from "next/og";

import { getShareCard } from "@/lib/data";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Token Plane 주간 사용량 공유 카드";

export default async function OpengraphImage({
  params,
}: {
  params: Promise<{ public_slug: string }>;
}) {
  const { public_slug: publicSlug } = await params;
  const card = await getShareCard(publicSlug);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          backgroundColor: "#10241a",
          backgroundImage:
            "linear-gradient(135deg, #10241a 0%, #1d4530 55%, #14532d 100%)",
          color: "#ffffff",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 34, fontWeight: 800, color: "#7ee2a8" }}>
            Token Plane · Global Weekly
          </div>
          <div style={{ display: "flex", marginTop: 28, fontSize: 76, fontWeight: 900 }}>
            {card?.displayName ?? "Token Plane"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 48 }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#a9c7b4" }}>
              주간 순위
            </div>
            <div style={{ display: "flex", fontSize: 88, fontWeight: 900 }}>
              {card?.rankPosition ? `#${card.rankPosition}` : "-"}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: "#a9c7b4" }}>
              주간 토큰
            </div>
            <div style={{ display: "flex", fontSize: 88, fontWeight: 900, color: "#7ee2a8" }}>
              {card?.scoreLabel ?? "-"}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              marginLeft: "auto",
              fontSize: 30,
              fontWeight: 700,
              color: "#a9c7b4",
            }}
          >
            {card ? `배지 ${card.badges.length}개 보유` : ""}
          </div>
        </div>
      </div>
    ),
    size,
  );
}

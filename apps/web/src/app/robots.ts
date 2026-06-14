import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();

  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // 로그인이 필요한 개인 페이지와 인증 콜백은 색인에서 제외
      disallow: ["/me", "/auth"],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}

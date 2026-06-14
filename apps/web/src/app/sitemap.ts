import type { MetadataRoute } from "next";

import { getSiteUrl } from "@/lib/env";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const lastModified = new Date();

  // 누구나 접근 가능한 공개 페이지만 색인 대상으로 노출한다.
  const routes: Array<{
    path: string;
    priority: number;
    changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  }> = [
    { path: "/", priority: 1, changeFrequency: "daily" },
    { path: "/ranking", priority: 0.9, changeFrequency: "daily" },
    { path: "/badges", priority: 0.7, changeFrequency: "weekly" },
    { path: "/install", priority: 0.8, changeFrequency: "monthly" },
    { path: "/settings", priority: 0.3, changeFrequency: "monthly" },
  ];

  return routes.map(({ path, priority, changeFrequency }) => ({
    url: `${siteUrl}${path}`,
    lastModified,
    changeFrequency,
    priority,
  }));
}

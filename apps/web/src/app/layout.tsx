import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { getSiteUrl } from "@/lib/env";

const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

const siteUrl = getSiteUrl();
const siteDescription =
  "AI 코딩 에이전트 사용량을 안전하게 모아 보는 Countoken";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Countoken",
    template: "%s | Countoken",
  },
  description: siteDescription,
  applicationName: "Countoken",
  keywords: [
    "Countoken",
    "카운토큰",
    "Claude Code",
    "Codex",
    "토큰 사용량",
    "AI 코딩 사용량",
    "토큰 랭킹",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: "Countoken",
    title: "Countoken",
    description: siteDescription,
    url: siteUrl,
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Countoken",
    description: siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION,
    other: process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION
      ? {
          "naver-site-verification":
            process.env.NEXT_PUBLIC_NAVER_SITE_VERIFICATION,
        }
      : {},
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`h-full antialiased ${pretendard.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

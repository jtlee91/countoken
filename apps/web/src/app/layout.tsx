import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Token Plane",
  description: "Claude Code와 Codex 사용량을 안전하게 모아 보는 Token Plane",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

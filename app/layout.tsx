import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vibaocode",
  description: "A lightweight AI coding workspace with GitHub, mobile preview and review-first edits.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import LocalControlPanel from "../components/LocalControlPanel";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vibaocode",
  description: "A local-first AI coding workspace with GitHub, mobile preview and review-first edits.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        {children}
        <LocalControlPanel />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "@fontsource-variable/manrope/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Acquisition Gap Analyzer",
  description:
    "Find the three website gaps costing your business new customers, backed by crawl evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

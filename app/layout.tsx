import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Aholo Creator Copilot",
  description: "From a product idea to an export-ready 3D asset.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="aurora">
      <body>{children}</body>
    </html>
  );
}

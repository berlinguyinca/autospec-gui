import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Autospec Telemetry",
  description: "Read-only autospec telemetry dashboard"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

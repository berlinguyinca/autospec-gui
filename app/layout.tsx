import type { Metadata } from "next";
import "./globals.css";

const primaryNavigation = [
  { href: "/", label: "Overview" },
  { href: "/runs", label: "Runs" },
  { href: "/issues", label: "Issues" },
  { href: "/discovery-audit", label: "Discovery Audit" },
  { href: "/pull-requests", label: "Pull Requests" },
  { href: "/errors", label: "Errors" }
];

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
      <body>
        <div className="app-shell">
          <header className="site-header">
            <a className="brand" href="/" aria-label="Autospec telemetry overview">
              Autospec Telemetry
            </a>
            <nav className="primary-nav" aria-label="Primary navigation">
              {primaryNavigation.map((item) => (
                <a href={item.href} key={item.href}>{item.label}</a>
              ))}
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}

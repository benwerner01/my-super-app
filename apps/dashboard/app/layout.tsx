import type { Metadata } from "next";
import { AutoRefresh } from "../components/auto-refresh.tsx";
import { Nav } from "../components/nav.tsx";
import "./globals.css";

// The shell renders the current time, so it must not be captured at build time
// either. Everything below this layout reads the filesystem per request.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "my-super-app",
  description: "Local, read-only view of this repo's automations",
};

const REFRESH_MS = 10_000;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const renderedAt = new Date();
  const clock = `${String(renderedAt.getHours()).padStart(2, "0")}:${String(renderedAt.getMinutes()).padStart(2, "0")}:${String(renderedAt.getSeconds()).padStart(2, "0")}`;

  return (
    <html lang="en">
      <body className="font-sans">
        <AutoRefresh intervalMs={REFRESH_MS} />
        <div className="flex min-h-screen">
          <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-panel">
            <div className="border-b border-line px-4 py-4">
              <div className="text-sm font-semibold tracking-tight">my-super-app</div>
              <div className="mt-0.5 text-xs text-faint">automation dashboard</div>
            </div>
            <Nav />
            <div className="mt-auto border-t border-line px-4 py-3 font-mono text-[11px] text-faint">
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-1.5 rounded-full bg-ok" />
                <span>read-only · 127.0.0.1</span>
              </div>
              <div className="mt-1">rendered {clock}</div>
            </div>
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </body>
    </html>
  );
}

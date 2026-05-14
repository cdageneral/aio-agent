import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";

export const metadata: Metadata = {
  title: "AIO Coverage Tracker",
  description: "Track Google AI Overview coverage of a brand vs its competitors.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="max-w-7xl mx-auto px-6 py-3.5 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg grid place-items-center text-xs font-bold"
                style={{ background: "linear-gradient(135deg, var(--accent-blue), var(--accent-cyan))", color: "#06070b" }}
              >
                AIO
              </div>
              <span className="font-semibold tracking-tight">AIO Coverage Tracker</span>
            </Link>
            <nav className="text-sm flex items-center gap-4">
              <Link href="/" className="muted hover:text-white transition">Projects</Link>
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
        {/* Chart.js — used by ShareOfVoiceHero (recharts powers the other charts). */}
        <Script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}

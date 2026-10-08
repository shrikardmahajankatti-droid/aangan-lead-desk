import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aangan Lead Desk",
  description: "AI phone desk for Aangan Studio — call log, qualification and handoff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-stone-200 bg-white/70 backdrop-blur dark:border-stone-800 dark:bg-stone-950/70">
          <nav className="mx-auto flex w-full max-w-7xl items-center gap-6 px-4 py-3 text-sm">
            <Link href="/" className="font-semibold tracking-tight">
              <span className="text-accent">Aangan</span> Lead Desk
            </Link>
            <Link href="/" className="text-stone-600 hover:text-foreground dark:text-stone-400">Dashboard</Link>
            <Link href="/upload" className="text-stone-600 hover:text-foreground dark:text-stone-400">Upload seed PDF</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}

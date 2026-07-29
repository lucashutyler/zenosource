import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  // `template` rather than a fixed string: every one of the app's 23 routes
  // rendered the identical title "ZenoSource", so browser history, tab
  // switching and bookmarks were all unusable — every entry looked the same.
  // Pages set their own `title` and inherit the suffix.
  title: {
    default: "ZenoSource",
    template: "%s · ZenoSource",
  },
  description: "Procurement that chases itself — purchase orders, RFQs and supplier collaboration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Manrope, Unbounded } from "next/font/google";
import { AppShell } from "@/components/shell/AppShell";
import { Providers } from "@/components/shell/Providers";
import "./globals.css";

// Mongolian needs cyrillic-ext (Ө ө Ү ү); Hanoi place names need the Vietnamese subset.
const manrope = Manrope({
  variable: "--font-body",
  subsets: ["latin", "cyrillic", "cyrillic-ext", "vietnamese"],
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
});

export const metadata: Metadata = {
  title: "AYLAND — Аяллыг тань хөнгөвчлөх анд",
  description: "Бие даан аялагчдад зориулсан AI аяллын анд: төлөвлөж, харьцуулж, зөвшөөрлөөр захиалж, хэлмэрчилнэ.",
};

export const viewport: Viewport = {
  themeColor: "#0b0d13",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="mn" className={`${manrope.variable} ${unbounded.variable} h-full`}>
      <body className="h-full overflow-hidden">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}

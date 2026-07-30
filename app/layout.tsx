import type { Metadata } from "next";
import { Montserrat, Shantell_Sans } from "next/font/google";
import "./globals.css";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

// The portal's voice: a neat handwritten sans to match the ink illustrations.
const shantell = Shantell_Sans({
  subsets: ["latin"],
  variable: "--font-shantell",
  display: "swap",
});

export const metadata: Metadata = {
  title: "The Lettings Expert — Partner Portal",
  description:
    "Partner portal and business dashboard for The Lettings Expert — live agent stats, forecasts and the owner's overview.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${montserrat.variable} ${shantell.variable}`}>
      <body>{children}</body>
    </html>
  );
}

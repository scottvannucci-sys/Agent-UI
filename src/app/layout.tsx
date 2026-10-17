import type { Metadata } from "next";
import { Press_Start_2P, VT323 } from "next/font/google";
import "./globals.css";

const pixel = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-pixel",
});

const terminal = VT323({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-terminal",
});

export const metadata: Metadata = {
  title: "Dunder Bots, Inc. — Hermes Bot Office",
  description:
    "A pixel-art, The Office-themed GUI that visualizes Hermes bots working, chatting and meeting — powered by live Hermes Desktop data.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${pixel.variable} ${terminal.variable}`}>
      <body>{children}</body>
    </html>
  );
}

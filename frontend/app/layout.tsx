import type { Metadata } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import "@livekit/components-styles";

const nunito = Nunito({ subsets: ["latin"], variable: "--font-nunito" });

export const metadata: Metadata = {
  title: "Voice Agent — Live Monitor",
  description: "Conversational voice agent with live monitoring and warm transfer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={nunito.variable}>
      <body>{children}</body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import "@livekit/components-styles";

export const metadata: Metadata = {
  title: "Voice Agent — Live Monitor",
  description: "Conversational voice agent with live monitoring and warm transfer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

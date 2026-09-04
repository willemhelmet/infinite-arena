import type { Metadata } from "next";
import "@reactor-team/ui/styles.css";
import "./globals.css";
import { GameProvider } from "@/lib/game/GameProvider";

export const metadata: Metadata = {
  title: "Infinite Arena",
  description:
    "Create a fighter, enter the arena, and battle in a real-time AI-generated fight judged by an LLM",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <GameProvider>{children}</GameProvider>
      </body>
    </html>
  );
}

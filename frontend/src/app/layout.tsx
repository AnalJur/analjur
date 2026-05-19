import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SidebarProvider } from "@/components/SidebarContext";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AnalJur — Análise Inteligente de Processos",
  description: "Plataforma de análise inteligente de processos jurídicos com IA.",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico",  sizes: "any" },
      { url: "/icon-32.png",  sizes: "32x32",  type: "image/png" },
      { url: "/icon-16.png",  sizes: "16x16",  type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AnalJur",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="font-sans">
        <SidebarProvider>{children}</SidebarProvider>
      </body>
    </html>
  );
}

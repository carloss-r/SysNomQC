import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/features/auth/auth-provider";
import { NoticeProvider } from "@/shared/ui/notice-provider";
import { THEME_INIT_SCRIPT } from "@/shared/ui/theme-init";
import { ClientErrorMonitor } from "./client-error-monitor";

// next/font las sirve desde este mismo dominio, compatible con la política CSP.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  title: "Gestión de Personal | Cooperativa Quinta Generación",
  description: "Directorio y expedientes del personal de la Cooperativa Quinta Generación.",
  // Sistema interno con datos personales: que no lo indexe ningún buscador.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${dmSans.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ClientErrorMonitor />
        <NoticeProvider>
          <AuthProvider>{children}</AuthProvider>
        </NoticeProvider>
      </body>
    </html>
  );
}

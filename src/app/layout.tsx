import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/features/auth/auth-provider";
import { NoticeProvider } from "@/shared/ui/notice-provider";
import { ClientErrorMonitor } from "./client-error-monitor";

export const metadata: Metadata = {
  title: "Gestión de Personal | Cooperativa Quinta Generación",
  description: "Directorio y expedientes del personal de la Cooperativa Quinta Generación.",
  // Sistema interno con datos personales: que no lo indexe ningún buscador.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <ClientErrorMonitor />
        <NoticeProvider>
          <AuthProvider>{children}</AuthProvider>
        </NoticeProvider>
      </body>
    </html>
  );
}

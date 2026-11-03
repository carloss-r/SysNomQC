import type { Metadata } from "next";
import "./globals.css";
import { ClientErrorMonitor } from "./client-error-monitor";

export const metadata: Metadata = {
  title: "Gestión de Personal | Cooperativa Quinta Generación",
  description: "Directorio y expedientes del personal de la Cooperativa Quinta Generación.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        <ClientErrorMonitor />
        {children}
      </body>
    </html>
  );
}

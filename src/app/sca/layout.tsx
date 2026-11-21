import type { Metadata } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { FuelsShell } from "@/features/fuels-system/fuels-shell";
import "./sca.css";

// Sistema de Combustibles Alternos (SCA): ruta privada que no aparece en los menús del sistema principal.
// Mismas cuentas, permisos y API que el módulo de combustibles; presentación propia.
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sca", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-sca-mono", display: "swap" });

export const metadata: Metadata = {
  title: "SCA · Combustibles Alternos",
  description: "Sistema de combustibles alternos y sustitución térmica.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ScaLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${sans.variable} ${mono.variable} sca-fonts`}>
      <FuelsShell>{children}</FuelsShell>
    </div>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { FuelsShell } from "@/features/fuels-system/fuels-shell";
import "./sca.css";

// Sistema de Combustibles Alternos (SCA): ruta privada que no aparece en los menús del sistema principal.
// Mismas cuentas, permisos y API que el módulo de combustibles; presentación propia.
const grotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-sca", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-sca-mono", display: "swap" });

export const metadata: Metadata = {
  title: "SCA · Combustibles Alternos",
  description: "Sistema de combustibles alternos y sustitución térmica.",
  robots: { index: false, follow: false, nocache: true },
};

export default function ScaLayout({ children }: { children: ReactNode }) {
  return (
    <div className={`${grotesk.variable} ${mono.variable} sca-fonts`}>
      <FuelsShell>{children}</FuelsShell>
    </div>
  );
}

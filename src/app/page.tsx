import type { Metadata } from "next";
import { LandingPage } from "@/features/landing/landing-page";
import { SITE_NAME } from "@/lib/site";

// Página pública: lo único que Google puede indexar. El sistema interno vive en /personal (con sesión).
export const metadata: Metadata = {
  title: { absolute: SITE_NAME },
  description:
    "Cooperativa Quinta Generación: sociedad cooperativa de trabajo con personal operativo, seguridad e higiene y control de combustibles alternos. Conoce quiénes somos y contáctanos.",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export default function Home() {
  return <LandingPage />;
}

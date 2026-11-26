import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/features/auth/auth-provider";
import { DialogProvider } from "@/shared/ui/dialog-provider";
import { NetworkStatus } from "@/shared/ui/loading";
import { NoticeProvider } from "@/shared/ui/notice-provider";
import { SITE_DESCRIPTION, SITE_NAME, siteUrl } from "@/lib/site";
import { THEME_INIT_SCRIPT } from "@/shared/ui/theme-init";
import { ClientErrorMonitor } from "./client-error-monitor";
import { VercelAnalytics } from "./vercel-analytics";

// next/font las sirve desde este mismo dominio, compatible con la política CSP.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_NAME, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: "es_MX",
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [{ url: "/logo-cooperativa.jpg", width: 447, height: 447, alt: SITE_NAME }],
  },
  // Pantallas internas con datos personales: fuera de los buscadores. Solo la portada lo cambia.
  robots: { index: false, follow: false, nocache: true },
};

// Datos de la organización para Google (nombre, logo, dirección del sitio).
const ORGANIZATION_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  alternateName: ["Quinta Generación", "Cooperativa Quinta Generacion"],
  url: siteUrl(),
  logo: `${siteUrl()}/logo-cooperativa.jpg`,
}).replace(/</g, "\\u003c");

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${dmSans.variable} ${manrope.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ORGANIZATION_JSON_LD }} />
      </head>
      <body>
        <ClientErrorMonitor />
        <NetworkStatus />
        <NoticeProvider>
          <DialogProvider>
            <AuthProvider>{children}</AuthProvider>
          </DialogProvider>
        </NoticeProvider>
        <VercelAnalytics />
      </body>
    </html>
  );
}

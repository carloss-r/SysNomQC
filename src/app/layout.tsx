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

// Datos para Google: la organización (nombre, logo para la ficha lateral) y el nombre del sitio en los resultados.
// Si la cooperativa tiene Facebook, LinkedIn, etc., agrega sus enlaces en `sameAs`: ayudan a que Google arme la ficha.
const SAME_AS: string[] = [];
const ORGANIZATION_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${siteUrl()}/#organizacion`,
      name: SITE_NAME,
      legalName: "Cooperativa Quinta Generación, S.C. de R.L. de C.V.",
      alternateName: ["Quinta Generación", "Cooperativa Quinta Generacion", "Quinta Generacion"],
      url: `${siteUrl()}/`,
      logo: {
        "@type": "ImageObject",
        "@id": `${siteUrl()}/#logo`,
        url: `${siteUrl()}/logo-cooperativa.jpg`,
        contentUrl: `${siteUrl()}/logo-cooperativa.jpg`,
        width: 447,
        height: 447,
        caption: SITE_NAME,
      },
      image: { "@id": `${siteUrl()}/#logo` },
      ...(SAME_AS.length ? { sameAs: SAME_AS } : {}),
    },
    {
      "@type": "WebSite",
      "@id": `${siteUrl()}/#sitio`,
      name: SITE_NAME,
      alternateName: ["Quinta Generación", "Quinta Generacion"],
      url: `${siteUrl()}/`,
      inLanguage: "es-MX",
      publisher: { "@id": `${siteUrl()}/#organizacion` },
    },
  ],
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

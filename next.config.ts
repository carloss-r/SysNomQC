import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Único origen externo permitido: el proyecto de Supabase (API, Auth y fotos firmadas).
function supabaseOrigin(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
}

const supabase = supabaseOrigin();

// Barra de comentarios de Vercel: solo en despliegues de vista previa (ramas), nunca en producción.
const vercelPreview = process.env.VERCEL_ENV === "preview";
const toolbar = (sources: string) => (vercelPreview ? ` ${sources}` : "");

// Next.js inyecta scripts y estilos en línea, por eso 'unsafe-inline'. Todo lo demás es estricto:
// sin plugins, sin iframes, sin formularios hacia otros sitios y solo conexiones a este
// dominio y a Supabase. ('unsafe-eval' y ws: solo en desarrollo para el recargado en caliente.)
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}${toolbar("https://vercel.live")}`,
  `style-src 'self' 'unsafe-inline'${toolbar("https://vercel.live")}`,
  `img-src 'self' data: blob: ${supabase}${toolbar("https://vercel.live https://vercel.com")}`.trim(),
  `font-src 'self' data:${toolbar("https://vercel.live https://assets.vercel.com")}`,
  `connect-src 'self' ${supabase}${isDev ? " ws: wss:" : ""}${toolbar("https://vercel.live wss://ws-us3.pusher.com")}`.trim(),
  // Sin iframes: el PDF de las facturas se dibuja en <canvas> con pdf.js (ya no hay visor embebido).
  `frame-src ${vercelPreview ? "https://vercel.live" : "'none'"}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self'",
  // Ningún atributo onclick="…" en el HTML (React no los usa): bloquea inyecciones en atributos.
  "script-src-attr 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  // En producción todo lo que se cargue por http:// se pide por https://.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  // Dos años de HTTPS obligatorio en el dominio y sus subdominios.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), hid=(), midi=(), " +
      "magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=(), interest-cohort=()",
  },
  { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Origin-Agent-Cluster", value: "?1" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
];

// Todo menos la portada, robots.txt, sitemap.xml y el logo queda fuera de Google.
const NOINDEX_SOURCE = "/:path((?!robots\\.txt$|sitemap\\.xml$|favicon\\.ico$|icon\\.png$|apple-icon\\.png$|logo-cooperativa\\.jpg$).+)";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  allowedDevOrigins: ["192.168.56.1"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: NOINDEX_SOURCE, headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }] },
      // Datos personales: nunca deben quedar en cachés del navegador ni de intermediarios.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;

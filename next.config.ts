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

// Next.js inyecta scripts y estilos en línea, por eso 'unsafe-inline'. Todo lo demás es estricto:
// sin plugins, sin iframes, sin formularios hacia otros sitios y solo conexiones a este
// dominio y a Supabase. ('unsafe-eval' y ws: solo en desarrollo para el recargado en caliente.)
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' ${supabase}${isDev ? " ws: wss:" : ""}`.trim(),
  // Vista previa de facturas: el PDF se descarga del bucket privado y se muestra como blob: local.
  "frame-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  productionBrowserSourceMaps: false,
  allowedDevOrigins: ["192.168.56.1"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Datos personales: nunca deben quedar en cachés del navegador ni de intermediarios.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store, max-age=0" }] },
    ];
  },
};

export default nextConfig;

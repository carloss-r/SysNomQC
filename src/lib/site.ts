/**
 * Dirección pública del sistema (dominio propio), para el sitemap, robots.txt y las etiquetas de Google.
 * En Vercel: variable NEXT_PUBLIC_SITE_URL = https://tu-dominio.com (sin "/" al final).
 * Si falta, usa el dominio de producción que Vercel expone automáticamente.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

export const SITE_NAME = "Cooperativa Quinta Generación";
export const SITE_DESCRIPTION =
  "Sistema interno de la Cooperativa Quinta Generación. Acceso solo para personal autorizado.";

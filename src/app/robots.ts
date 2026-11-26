import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Google solo puede ver la portada (inicio de sesión) y lo que necesita para mostrarla.
// Todo lo demás queda bloqueado. No se listan las rutas internas para no revelarlas.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/$", "/sitemap.xml", "/_next/static/", "/icon.png", "/logo-cooperativa.jpg"],
        disallow: "/",
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}

import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

// Solo la portada (inicio de sesión) es pública. Las pantallas internas requieren sesión y no se indexan.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: `${siteUrl()}/`, lastModified: new Date(), changeFrequency: "monthly", priority: 1 }];
}

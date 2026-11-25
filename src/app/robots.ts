import type { MetadataRoute } from "next";

// Sistema interno con datos personales: ningún buscador debe indexarlo (también lo dice X-Robots-Tag).
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}

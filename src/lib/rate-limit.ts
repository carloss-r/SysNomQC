// Límite de peticiones por IP en memoria (ventana deslizante). En un entorno serverless cada
// instancia lleva su propio contador, así que frena abusos y ráfagas pero no reemplaza un
// límite global (por ejemplo el WAF / Firewall de Vercel).

type Hit = { windowStart: number; count: number };

const buckets = new Map<string, Hit>();
const MAX_KEYS = 5_000;

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  if (buckets.size > MAX_KEYS) {
    for (const [bucketKey, hit] of buckets) {
      if (now - hit.windowStart > windowMs) buckets.delete(bucketKey);
    }
    if (buckets.size > MAX_KEYS) buckets.clear();
  }

  const hit = buckets.get(key);
  if (!hit || now - hit.windowStart > windowMs) {
    buckets.set(key, { windowStart: now, count: 1 });
    return true;
  }

  hit.count += 1;
  return hit.count <= limit;
}

export function clientIp(headers: Headers): string {
  return (
    headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "desconocida"
  );
}

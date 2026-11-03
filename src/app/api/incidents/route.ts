import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allowClientIncident, reportIncident } from "@/lib/incidents";

const incidentSchema = z
  .object({
    source: z.string().trim().min(1).max(80),
    message: z.string().trim().min(1).max(500),
    stack: z.string().max(4000).optional(),
    url: z.string().max(300).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

// Recibe errores ocurridos en el navegador (red caída, errores de JavaScript) y los envía por correo.
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) {
    let sameOrigin = false;
    try {
      sameOrigin = new URL(origin).host === request.headers.get("host");
    } catch {
      sameOrigin = false;
    }
    if (!sameOrigin) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  if (!allowClientIncident(ip)) {
    return NextResponse.json({ error: "Demasiados reportes." }, { status: 429 });
  }

  const raw = await request.text();
  if (raw.length > 10_000) {
    return NextResponse.json({ error: "Reporte demasiado grande." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON no válido." }, { status: 400 });
  }

  const parsed = incidentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Reporte no válido." }, { status: 400 });
  }

  await reportIncident({ ...parsed.data, source: `navegador · ${parsed.data.source}` });
  return NextResponse.json({ ok: true }, { status: 202 });
}

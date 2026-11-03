import { after } from "next/server";

// Servicio de incidencias: envía por correo (API de Resend, sin dependencias extra)
// los errores que ocurren en el sistema para poder monitorearlo.
//
// Variables de entorno (solo servidor):
//   RESEND_API_KEY          Clave de https://resend.com (obligatoria para enviar correos)
//   INCIDENT_EMAIL_TO       Destinatario (por defecto crlos.trabajo.dev@gmail.com)
//   INCIDENT_EMAIL_FROM     Remitente (por defecto "SysNomQC <onboarding@resend.dev>")

const DEFAULT_TO = "crlos.trabajo.dev@gmail.com";
const DEFAULT_FROM = "SysNomQC <onboarding@resend.dev>";

// Límites para evitar spam de correos (y costos) si algo falla en bucle.
const DEDUPE_WINDOW_MS = 10 * 60_000; // el mismo error se envía una vez cada 10 minutos
const MAX_EMAILS_PER_HOUR = 20;
const CLIENT_LIMIT_PER_MINUTE = 10;

export type Incident = {
  source: string;
  message: string;
  severity?: "error" | "warning";
  stack?: string;
  url?: string;
  context?: Record<string, unknown>;
};

const recent = new Map<string, { lastSent: number; suppressed: number }>();
let hourStart = Date.now();
let sentThisHour = 0;
const clientHits = new Map<string, { windowStart: number; count: number }>();

/** Quita datos personales y secretos antes de enviar nada por correo. */
function redact(text: string): string {
  return text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[token]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo]")
    .replace(/\b[A-Z]{4}\d{6}[A-Z0-9]{8}\b/g, "[curp]")
    .replace(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/g, "[rfc]")
    .replace(/\b\d{10,}\b/g, "[número]");
}

function fingerprint(incident: Incident) {
  return `${incident.source}|${incident.message.replace(/\d+/g, "#").slice(0, 160)}`;
}

/** Límite por IP para el endpoint público de incidencias del navegador. */
export function allowClientIncident(key: string): boolean {
  const now = Date.now();
  if (clientHits.size > 500) {
    for (const [hitKey, hit] of clientHits) {
      if (now - hit.windowStart > 60_000) clientHits.delete(hitKey);
    }
  }
  const hit = clientHits.get(key);
  if (!hit || now - hit.windowStart > 60_000) {
    clientHits.set(key, { windowStart: now, count: 1 });
    return true;
  }
  hit.count += 1;
  return hit.count <= CLIENT_LIMIT_PER_MINUTE;
}

/** Envía la incidencia por correo. Nunca lanza errores. */
export async function reportIncident(incident: Incident): Promise<void> {
  try {
    const now = Date.now();
    const key = fingerprint(incident);

    if (now - hourStart > 3_600_000) {
      hourStart = now;
      sentThisHour = 0;
    }
    if (recent.size > 200) {
      for (const [recentKey, entry] of recent) {
        if (now - entry.lastSent > DEDUPE_WINDOW_MS) recent.delete(recentKey);
      }
    }

    const previous = recent.get(key);
    if (previous && now - previous.lastSent < DEDUPE_WINDOW_MS) {
      previous.suppressed += 1;
      return;
    }
    if (sentThisHour >= MAX_EMAILS_PER_HOUR) return;

    const repeated = previous?.suppressed ?? 0;
    recent.set(key, { lastSent: now, suppressed: 0 });
    sentThisHour += 1;

    const severity = incident.severity ?? "error";
    const message = redact(incident.message).slice(0, 500);
    const lines = [
      `Severidad: ${severity}`,
      `Origen: ${incident.source}`,
      `Mensaje: ${message}`,
      `Fecha: ${new Date(now).toLocaleString("es-MX", { timeZone: "America/Mexico_City" })} (hora de México)`,
      `Entorno: ${process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "desconocido"}`,
      incident.url ? `Página: ${redact(incident.url).slice(0, 300)}` : "",
      repeated > 0 ? `Se repitió ${repeated} veces desde el último aviso.` : "",
      incident.context ? `Contexto: ${redact(JSON.stringify(incident.context)).slice(0, 1500)}` : "",
      incident.stack ? `\nDetalle técnico:\n${redact(incident.stack).slice(0, 3000)}` : "",
    ].filter(Boolean);

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[incidencias] RESEND_API_KEY no configurada; no se envió el correo:", message);
      return;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.INCIDENT_EMAIL_FROM || DEFAULT_FROM,
        to: [process.env.INCIDENT_EMAIL_TO || DEFAULT_TO],
        subject: `[SysNomQC] ${severity} · ${incident.source}: ${message.slice(0, 80)}`,
        text: lines.join("\n"),
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      console.error("[incidencias] Resend rechazó el correo:", response.status);
    }
  } catch (error) {
    console.error("[incidencias] No se pudo enviar el correo de incidencia:", error);
  }
}

/**
 * Reporta un error del servidor sin retrasar la respuesta al usuario.
 * Acepta Error, errores de Supabase ({ message, code }) o texto.
 */
export function reportServerIncident(
  source: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const details = error as { message?: unknown; code?: unknown } | null;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : typeof details?.message === "string"
          ? details.message
          : "Error desconocido";

  const task = reportIncident({
    source,
    message,
    stack: error instanceof Error ? error.stack : undefined,
    context: { ...(details?.code ? { code: details.code } : {}), ...context },
  });

  try {
    after(task);
  } catch {
    void task; // fuera de una solicitud: se deja correr en segundo plano
  }
}

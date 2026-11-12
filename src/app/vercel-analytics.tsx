"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics: visitas por pantalla, países, dispositivos y navegadores.
 * No usa cookies. El script y los envíos van a /_vercel/insights en este mismo dominio,
 * así que la política CSP no necesita cambios.
 *
 * Por privacidad se quita todo lo que va después de "?" o "#" en la dirección
 * (sede, pestaña, filtros): solo se registra la ruta, p. ej. "/epp".
 */
function stripQuery(event: BeforeSendEvent): BeforeSendEvent {
  const url = new URL(event.url);
  url.search = "";
  url.hash = "";
  return { ...event, url: url.toString() };
}

export function VercelAnalytics() {
  return <Analytics beforeSend={stripQuery} />;
}

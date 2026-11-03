// Reporte de incidencias desde el navegador. Solo se usa para fallos que el servidor no
// puede ver (red caída, errores de JavaScript, caída de renderizado). Los errores de la API
// ya los reporta el propio servidor, por eso no se duplican aquí.

const MAX_REPORTS_PER_PAGE_LOAD = 5;
const alreadyReported = new Set<string>();

export function reportClientIncident(
  source: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  try {
    if (typeof window === "undefined" || alreadyReported.size >= MAX_REPORTS_PER_PAGE_LOAD) return;

    const message =
      (error instanceof Error ? error.message : typeof error === "string" ? error : "") ||
      "Error sin mensaje";
    const key = `${source}|${message}`;
    if (alreadyReported.has(key)) return;
    alreadyReported.add(key);

    const body = JSON.stringify({
      source: source.slice(0, 80),
      message: message.slice(0, 500),
      stack: error instanceof Error ? error.stack?.slice(0, 4000) : undefined,
      url: window.location.origin + window.location.pathname,
      context,
    });

    void fetch("/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Reportar un error nunca debe provocar otro error.
  }
}

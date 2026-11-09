// Correo operativo (no de incidencias) por la API de Resend. Solo servidor.
// Usa RESEND_API_KEY e INCIDENT_EMAIL_FROM (mismo remitente que las incidencias).

const DEFAULT_FROM = "SysNomQC <onboarding@resend.dev>";

/** Envía un correo de texto. Devuelve false (y lo registra) si no se pudo; nunca lanza errores. */
export async function sendEmail(to: string[], subject: string, text: string): Promise<boolean> {
  const recipients = to.map((item) => item.trim()).filter(Boolean);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || recipients.length === 0) {
    console.warn(`[correo] sin RESEND_API_KEY o sin destinatario; no se envió: ${subject}`);
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.INCIDENT_EMAIL_FROM || DEFAULT_FROM, to: recipients, subject, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) console.error("[correo] Resend rechazó el correo:", response.status);
    return response.ok;
  } catch (error) {
    console.error("[correo] no se pudo enviar:", error);
    return false;
  }
}

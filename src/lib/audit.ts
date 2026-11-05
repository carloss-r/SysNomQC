import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { Access } from "@/lib/permissions";
import { clientIp } from "@/lib/rate-limit";

/**
 * Bitácora de auditoría (tabla public.audit_log, solo accesible con la llave de servidor).
 * Registra quién hizo qué y desde dónde; nunca guarda datos personales de los expedientes,
 * solo identificadores y los nombres de los campos modificados. Es "mejor esfuerzo": un fallo
 * al escribir la bitácora se registra en el log del servidor pero no interrumpe la operación.
 */
export async function recordAudit(
  request: NextRequest,
  access: Access,
  action: string,
  target: string | number | null,
  meta?: Record<string, unknown>,
): Promise<void> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      console.warn(`[auditoría] sin SUPABASE_SERVICE_ROLE_KEY, no se guardó: ${action}`);
      return;
    }

    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await admin.from("audit_log").insert({
      user_id: access.user_id,
      email: access.email,
      action,
      target: target === null ? null : String(target),
      ip: clientIp(request.headers),
      user_agent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
      meta: meta ?? {},
    });
    if (error) console.error("[auditoría] no se pudo guardar:", error.message);
  } catch (error) {
    console.error("[auditoría] error inesperado:", error);
  }
}

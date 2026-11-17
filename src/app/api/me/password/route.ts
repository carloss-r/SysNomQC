import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { clearAccessCache } from "@/lib/access-cache";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { MIN_PASSWORD_LENGTH } from "@/lib/permissions";
import { rateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase-admin";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";

const passwordSchema = z
  .object({
    /** Opcional: si se escribe, se verifica; si se deja vacía, se cambia sin ella (la sesión ya está iniciada). */
    current_password: z.string().max(72).optional(),
    new_password: z.string().min(MIN_PASSWORD_LENGTH).max(72),
  })
  .strict();

/**
 * Cambio de contraseña de la propia cuenta (con la sesión iniciada). La contraseña actual es opcional:
 * si el usuario la escribe se verifica; si no la recuerda puede dejarla vacía.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  if (!rateLimit(`password:${auth.access.user_id}`, 5, 15 * 60_000)) {
    return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, { status: 429 });
  }
  try {
    const input = passwordSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json({ error: `La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.` }, { status: 400 });
    }
    const { current_password, new_password } = input.data;
    if (current_password && current_password === new_password) {
      return NextResponse.json({ error: "La nueva contraseña debe ser distinta de la actual." }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
    const admin = createServiceClient();
    if (!url || !publishableKey || !admin) {
      return NextResponse.json({ error: "El servidor no está configurado para cambiar contraseñas." }, { status: 500 });
    }

    // Si escribió la contraseña actual, se verifica sin tocar la sesión del navegador.
    if (current_password) {
      const verifier = createClient(url, publishableKey, { auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false } });
      const check = await verifier.auth.signInWithPassword({ email: auth.access.email, password: current_password });
      if (check.error || !check.data.session) {
        if (check.error && (check.error.name === "AuthRetryableFetchError" || (check.error.status ?? 0) >= 500)) {
          reportServerIncident("api · cambiar contraseña · verificar", check.error);
          return NextResponse.json({ error: "No se pudo verificar tu contraseña. Inténtalo de nuevo." }, { status: 503 });
        }
        return NextResponse.json({ error: "La contraseña actual no es correcta. Si no la recuerdas, deja ese campo vacío." }, { status: 400 });
      }
      // Esa verificación abrió una sesión de servidor que no se usa: se descarta solo ESA
      // (scope "local"; el modo por defecto cerraría también la sesión del navegador).
      await verifier.auth.signOut({ scope: "local" }).catch(() => undefined);
    }

    const { error } = await admin.auth.admin.updateUserById(auth.access.user_id, { password: new_password });
    if (error) {
      if (/password/i.test(error.message) && (error.status ?? 0) < 500) {
        return NextResponse.json({ error: "Esa contraseña no se acepta; usa una más larga o menos común." }, { status: 400 });
      }
      throw error;
    }
    const flag = await admin.from("authorized_users").update({ must_change_password: false }).eq("user_id", auth.access.user_id);
    if (flag.error && flag.error.code !== "42703" && flag.error.code !== "PGRST204") throw flag.error;

    clearAccessCache();
    await recordAudit(request, auth.access, "account.password", auth.access.user_id, { verified_current: Boolean(current_password) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · cambiar contraseña", error);
    return NextResponse.json({ error: "No se pudo cambiar la contraseña." }, { status: 500 });
  }
}

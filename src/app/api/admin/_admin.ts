import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportServerIncident } from "@/lib/incidents";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createServiceClient } from "@/lib/supabase-admin";
import type { Access } from "@/lib/permissions";
import { getAuthenticatedClient } from "../employees/_server";

type AdminResult =
  | { access: Access; admin: SupabaseClient }
  | { response: NextResponse<{ error: string }> };

/** Solo cuentas con el permiso "users.manage". Usa la llave service_role (solo servidor). */
export async function requireAdmin(request: NextRequest): Promise<AdminResult> {
  const auth = await getAuthenticatedClient(request, "users.manage");
  if ("response" in auth) return auth;

  // Las acciones de administración tienen un límite más estricto que el resto de la API.
  if (!rateLimit(`admin:${clientIp(request.headers)}`, 60, 60_000)) {
    return {
      response: NextResponse.json({ error: "Demasiadas solicitudes. Espera un momento." }, { status: 429 }),
    };
  }

  const admin = createServiceClient();
  if (!admin) {
    return {
      response: NextResponse.json(
        {
          error:
            "El servidor no encuentra SUPABASE_SERVICE_ROLE_KEY. Agrégala en .env.local (y reinicia) o, en Vercel, en Environment Variables para el entorno de esta rama y vuelve a desplegar.",
        },
        { status: 500 },
      ),
    };
  }

  return { access: auth.access, admin };
}

export function adminDbError(error: { code?: string; message: string }) {
  console.error("Error en administración de usuarios/roles:", error);
  if (error.code === "23505") {
    return NextResponse.json({ error: "Ya existe un registro con ese nombre o correo." }, { status: 409 });
  }
  if (error.code === "23503") {
    return NextResponse.json(
      { error: "No se puede completar: el rol está en uso o el registro relacionado no existe." },
      { status: 409 },
    );
  }
  reportServerIncident("api · admin", error);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

export const badRequest = (message: string) => NextResponse.json({ error: message }, { status: 400 });

import { NextResponse, type NextRequest } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { reportServerIncident } from "@/lib/incidents";
import type { Access } from "@/lib/permissions";
import { getAuthenticatedClient } from "../employees/_server";

type AdminResult =
  | { access: Access; admin: SupabaseClient }
  | { response: NextResponse<{ error: string }> };

/** Solo cuentas con el permiso "users.manage". Usa la llave service_role (solo servidor). */
export async function requireAdmin(request: NextRequest): Promise<AdminResult> {
  const auth = await getAuthenticatedClient(request, "users.manage");
  if ("response" in auth) return auth;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return {
      response: NextResponse.json(
        { error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor." },
        { status: 500 },
      ),
    };
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthenticatedSupabaseClient } from "@/lib/database";
import { reportServerIncident } from "@/lib/incidents";
import { ALL_PERMISSIONS, type Access, type Permission } from "@/lib/permissions";

type AuthenticatedClientResult =
  | { client: SupabaseClient; access: Access }
  | { response: NextResponse<{ error: string }> };

type RoleRow = { nombre: string; permisos: string[] | null; es_sistema: boolean | null };

/** Valida la sesión y, si se indica, que el rol de la cuenta tenga ese permiso. */
export async function getAuthenticatedClient(
  request: NextRequest,
  permission?: Permission,
): Promise<AuthenticatedClientResult> {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!token) {
    return { response: NextResponse.json({ error: "Inicia sesión para continuar." }, { status: 401 }) };
  }

  try {
    const client = createAuthenticatedSupabaseClient(token);
    const { data: userData, error } = await client.auth.getUser(token);

    if (error) {
      return { response: NextResponse.json({ error: "La sesión no es válida o expiró." }, { status: 401 }) };
    }

    const { data: authorizedUser, error: authorizationError } = await client
      .from("authorized_users")
      .select("user_id,full_name,role:roles(nombre,permisos,es_sistema)")
      .eq("user_id", userData.user.id)
      .eq("active", true)
      .maybeSingle();

    if (authorizationError) {
      console.error("No se pudo validar el acceso del usuario:", authorizationError);
      reportServerIncident("api · validar acceso", authorizationError);
      return {
        response: NextResponse.json(
          { error: "No se pudo verificar que tu cuenta esté autorizada." },
          { status: 500 },
        ),
      };
    }

    if (!authorizedUser) {
      return {
        response: NextResponse.json(
          { error: "Tu cuenta no está autorizada para acceder al directorio." },
          { status: 403 },
        ),
      };
    }

    const role = authorizedUser.role as unknown as RoleRow | null;
    const isSuperAdmin = role?.es_sistema === true;
    const permissions = isSuperAdmin
      ? ALL_PERMISSIONS
      : ALL_PERMISSIONS.filter((item) => role?.permisos?.includes(item));
    const access: Access = {
      user_id: userData.user.id,
      email: userData.user.email ?? "",
      full_name: (authorizedUser.full_name as string | null) ?? null,
      role_name: role?.nombre ?? "Sin rol",
      is_super_admin: isSuperAdmin,
      permissions,
    };

    if (permission && !permissions.includes(permission)) {
      return {
        response: NextResponse.json(
          { error: "Tu rol no tiene permiso para realizar esta acción." },
          { status: 403 },
        ),
      };
    }

    return { client, access };
  } catch (error) {
    console.error("No se pudo inicializar la conexión autenticada de Supabase:", error);
    reportServerIncident("api · conexión Supabase", error);
    return {
      response: NextResponse.json(
        { error: "No se pudo conectar con el servicio de datos." },
        { status: 500 },
      ),
    };
  }
}

/** Error del cliente (400): no se reporta por correo porque no es una falla del sistema. */
export class BadJsonError extends Error {}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new BadJsonError("El cuerpo de la solicitud no contiene JSON válido.");
  }
}

export function databaseErrorResponse(error: { code?: string; message: string }) {
  console.error("Error en operación de empleados de Supabase:", error);

  if (error.code === "23505") {
    return NextResponse.json(
      { error: "Ya existe un empleado con ese ID, NSS, CURP o RFC." },
      { status: 409 },
    );
  }

  reportServerIncident("api · base de datos", error);

  return NextResponse.json(
    { error: "No se pudo completar la operación. Verifica los datos e inténtalo de nuevo." },
    { status: 500 },
  );
}

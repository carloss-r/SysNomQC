import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthenticatedSupabaseClient } from "@/lib/database";
import { reportServerIncident } from "@/lib/incidents";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { ALL_PERMISSIONS, type Access, type Permission } from "@/lib/permissions";

type AuthenticatedClientResult =
  | { client: SupabaseClient; access: Access }
  | { response: NextResponse<{ error: string }> };

type RoleRow = { nombre: string; permisos: string[] | null; es_sistema: boolean | null };

const API_LIMIT_PER_MINUTE = 240;
const MAX_BODY_BYTES = 100_000;

/** Las peticiones que modifican datos solo se aceptan desde esta misma aplicación. */
function isSameOrigin(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD") return true;
  const origin = request.headers.get("origin");
  if (!origin) return true; // clientes no-navegador: se protegen con el token Bearer
  try {
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Valida la sesión y, si se indica, que el rol de la cuenta tenga ese permiso. */
export async function getAuthenticatedClient(
  request: NextRequest,
  permission?: Permission,
): Promise<AuthenticatedClientResult> {
  // Límite de peticiones por IP (antes de tocar Supabase) y verificación de origen en cambios.
  if (!rateLimit(`api:${clientIp(request.headers)}`, API_LIMIT_PER_MINUTE, 60_000)) {
    return {
      response: NextResponse.json({ error: "Demasiadas solicitudes. Espera un momento." }, { status: 429 }),
    };
  }
  if (!isSameOrigin(request)) {
    return { response: NextResponse.json({ error: "Origen no permitido." }, { status: 403 }) };
  }

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

    const lookup = (columns: string) =>
      client.from("authorized_users").select(columns).eq("user_id", userData.user.id).eq("active", true).maybeSingle();
    let { data: authorizedUser, error: authorizationError } = await lookup(
      "user_id,full_name,site,role:roles(nombre,permisos,es_sistema)",
    );
    // Antes de ejecutar la migración de sedes la columna "site" no existe: se sigue entrando (todas las sedes).
    if (authorizationError?.code === "42703") {
      ({ data: authorizedUser, error: authorizationError } = await lookup("user_id,full_name,role:roles(nombre,permisos,es_sistema)"));
    }

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

    const row = authorizedUser as unknown as { full_name: string | null; site?: string | null; role: RoleRow | null };
    const role = row.role;
    const isSuperAdmin = role?.es_sistema === true;
    const permissions = isSuperAdmin
      ? ALL_PERMISSIONS
      : ALL_PERMISSIONS.filter((item) => role?.permisos?.includes(item));
    const access: Access = {
      user_id: userData.user.id,
      email: userData.user.email ?? "",
      full_name: row.full_name ?? null,
      role_name: role?.nombre ?? "Sin rol",
      is_super_admin: isSuperAdmin,
      permissions,
      site: isSuperAdmin ? null : (row.site ?? null),
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
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new BadJsonError("La solicitud es demasiado grande.");
    return JSON.parse(raw);
  } catch (error) {
    if (error instanceof BadJsonError) throw error;
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

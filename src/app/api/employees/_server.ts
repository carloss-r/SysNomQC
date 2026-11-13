import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCachedAccess, setCachedAccess } from "@/lib/access-cache";
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

  const denied = (access: Access) =>
    permission && !access.permissions.includes(permission)
      ? { response: NextResponse.json({ error: "Tu rol no tiene permiso para realizar esta acción." }, { status: 403 }) }
      : null;

  try {
    const client = createAuthenticatedSupabaseClient(token);

    // Acceso ya verificado hace unos segundos con este mismo token: no se vuelve a consultar.
    // Las acciones de administración siempre se verifican contra la base.
    const cached = permission === "users.manage" ? null : getCachedAccess(token);
    if (cached) return denied(cached) ?? { client, access: cached };

    const { data: userData, error } = await client.auth.getUser(token);

    if (error) {
      return { response: NextResponse.json({ error: "La sesión no es válida o expiró." }, { status: 401 }) };
    }

    const lookup = (columns: string) =>
      client.from("authorized_users").select(columns).eq("user_id", userData.user.id).eq("active", true).maybeSingle();
    // Cuenta y roles adicionales se piden al mismo tiempo (antes, uno después del otro).
    // Roles adicionales: migración 202611080001; si la tabla aún no existe, queda solo el rol principal.
    const [primary, extra] = await Promise.all([
      lookup("user_id,full_name,site,role:roles(nombre,permisos,es_sistema)"),
      client.from("authorized_user_roles").select("role:roles(nombre,permisos,es_sistema)").eq("user_id", userData.user.id),
    ]);
    let { data: authorizedUser, error: authorizationError } = primary;
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

    if (extra.error && !["42P01", "PGRST205"].includes(extra.error.code ?? "")) {
      console.error("No se pudieron leer los roles adicionales:", extra.error);
    }
    const roles: RoleRow[] = [];
    for (const candidate of [row.role, ...((extra.data ?? []) as unknown as { role: RoleRow | RoleRow[] | null }[]).map((item) => (Array.isArray(item.role) ? item.role[0] : item.role))]) {
      if (candidate && !roles.some((known) => known.nombre === candidate.nombre)) roles.push(candidate);
    }

    // Los permisos son la suma de los de todos los roles.
    const isSuperAdmin = roles.some((item) => item.es_sistema === true);
    const permissions = isSuperAdmin
      ? ALL_PERMISSIONS
      : ALL_PERMISSIONS.filter((item) => roles.some((roleItem) => roleItem.permisos?.includes(item)));
    const access: Access = {
      user_id: userData.user.id,
      email: userData.user.email ?? "",
      full_name: row.full_name ?? null,
      role_name: roles[0]?.nombre ?? "Sin rol",
      role_names: roles.map((item) => item.nombre),
      is_super_admin: isSuperAdmin,
      permissions,
      site: isSuperAdmin ? null : (row.site ?? null),
    };

    setCachedAccess(token, access);
    return denied(access) ?? { client, access };
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

  // Columna nueva aún no creada en este entorno (salario de cotización, baja…).
  if (error.code === "42703" || error.code === "PGRST204") {
    return NextResponse.json(
      { error: "Faltan migraciones de empleados en Supabase (hasta 202611130005_empleados_asignacion.sql)." },
      { status: 503 },
    );
  }

  reportServerIncident("api · base de datos", error);

  return NextResponse.json(
    { error: "No se pudo completar la operación. Verifica los datos e inténtalo de nuevo." },
    { status: 500 },
  );
}

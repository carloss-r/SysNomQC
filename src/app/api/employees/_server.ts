import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthenticatedSupabaseClient } from "@/lib/database";

type AuthenticatedClientResult =
  | { client: SupabaseClient }
  | { response: NextResponse<{ error: string }> };

export async function getAuthenticatedClient(
  request: NextRequest,
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
      .select("user_id")
      .eq("user_id", userData.user.id)
      .eq("active", true)
      .maybeSingle();

    if (authorizationError) {
      console.error("No se pudo validar el acceso del usuario:", authorizationError);
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

    return { client };
  } catch (error) {
    console.error("No se pudo inicializar la conexión autenticada de Supabase:", error);
    return {
      response: NextResponse.json(
        { error: "No se pudo conectar con el servicio de datos." },
        { status: 500 },
      ),
    };
  }
}

export async function readJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("El cuerpo de la solicitud no contiene JSON válido.");
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

  return NextResponse.json(
    { error: "No se pudo completar la operación. Verifica los datos e inténtalo de nuevo." },
    { status: 500 },
  );
}

import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedClient } from "../employees/_server";

// Rol y permisos de la cuenta que inició sesión (la interfaz oculta lo que no puede usar).
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json(auth.access);
}

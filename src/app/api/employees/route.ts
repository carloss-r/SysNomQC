import { NextResponse, type NextRequest } from "next/server";
import { databaseErrorResponse, getAuthenticatedClient, readJson } from "./_server";
import { employeeInputSchema } from "./validation";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;

  const offsetValue = Number(request.nextUrl.searchParams.get("offset") ?? 0);
  const limitValue = Number(request.nextUrl.searchParams.get("limit") ?? 500);
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const limit = Number.isSafeInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 500) : 500;

  try {
    const { data, error } = await auth.client
      .from("employees")
      .select("*")
      .order("full_name")
      .range(offset, offset + limit - 1);

    if (error) return databaseErrorResponse(error);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error inesperado al consultar empleados:", error);
    return NextResponse.json({ error: "No se pudo cargar el directorio." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;

  try {
    const input = employeeInputSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json(
        { error: "Revisa los campos obligatorios y el formato de los datos." },
        { status: 400 },
      );
    }

    const { data, error } = await auth.client
      .from("employees")
      .insert(input.data)
      .select("*")
      .single();

    if (error) return databaseErrorResponse(error);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error inesperado al crear empleado:", error);
    const message = error instanceof Error ? error.message : "No se pudo crear el empleado.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

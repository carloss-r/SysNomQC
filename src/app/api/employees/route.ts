import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, databaseErrorResponse, getAuthenticatedClient, readJson } from "./_server";
import {
  EMPLOYEE_LIST_SELECT,
  fetchEmployee,
  syncCredits,
  toEmployeeColumns,
  toSummary,
} from "./_mapper";
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
      .from("empleados")
      .select(EMPLOYEE_LIST_SELECT)
      .order("nombre_completo")
      .range(offset, offset + limit - 1);

    if (error) return databaseErrorResponse(error);
    return NextResponse.json((data ?? []).map((row) => toSummary(row as unknown as Parameters<typeof toSummary>[0])));
  } catch (error) {
    console.error("Error inesperado al consultar empleados:", error);
    reportServerIncident("api · listar empleados", error);
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

    const { credits, ...fields } = input.data;
    const { data: created, error } = await auth.client
      .from("empleados")
      .insert(toEmployeeColumns(fields))
      .select("id_empleado")
      .single();

    if (error) return databaseErrorResponse(error);
    const employeeId = created.id_empleado as number;

    const creditsError = await syncCredits(auth.client, employeeId, credits);
    if (creditsError) {
      // Sin transacciones en el cliente: se revierte el alta para no dejar un expediente a medias.
      await auth.client.from("empleados").delete().eq("id_empleado", employeeId);
      return databaseErrorResponse(creditsError);
    }

    const { employee, error: readError } = await fetchEmployee(auth.client, employeeId);
    if (readError) return databaseErrorResponse(readError);
    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    console.error("Error inesperado al crear empleado:", error);
    if (error instanceof BadJsonError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportServerIncident("api · crear empleado", error);
    return NextResponse.json({ error: "No se pudo crear el empleado." }, { status: 500 });
  }
}

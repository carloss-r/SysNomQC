import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, databaseErrorResponse, getAuthenticatedClient, readJson } from "../_server";
import { fetchEmployee, syncCredits, toEmployeeColumns } from "../_mapper";
import { employeeIdSchema, employeePatchSchema } from "../validation";

type RouteContext = { params: Promise<{ id: string }> };

const invalidId = () =>
  NextResponse.json({ error: "El identificador del empleado no es válido." }, { status: 400 });

// Expediente completo de un empleado (se pide solo al abrirlo, no en la lista).
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;

  const parsedId = employeeIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return invalidId();

  try {
    const { employee, error } = await fetchEmployee(auth.client, parsedId.data);
    if (error) return databaseErrorResponse(error);
    if (!employee) return NextResponse.json({ error: "No se encontró el empleado." }, { status: 404 });
    return NextResponse.json(employee);
  } catch (error) {
    console.error("Error inesperado al consultar empleado:", error);
    reportServerIncident("api · consultar empleado", error);
    return NextResponse.json({ error: "No se pudo cargar el expediente." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;

  const parsedId = employeeIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return invalidId();
  const employeeId = parsedId.data;

  try {
    const input = employeePatchSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json(
        { error: "Revisa los campos enviados y sus formatos." },
        { status: 400 },
      );
    }

    const { credits, ...fields } = input.data;
    const columns = toEmployeeColumns(fields);

    if (Object.keys(columns).length > 0) {
      const { data, error } = await auth.client
        .from("empleados")
        .update(columns)
        .eq("id_empleado", employeeId)
        .select("id_empleado");

      if (error) return databaseErrorResponse(error);
      if (!data || data.length === 0) {
        return NextResponse.json({ error: "No se encontró el empleado." }, { status: 404 });
      }
    }

    if (credits) {
      const creditsError = await syncCredits(auth.client, employeeId, credits);
      if (creditsError) return databaseErrorResponse(creditsError);
    }

    const { employee, error: readError } = await fetchEmployee(auth.client, employeeId);
    if (readError) return databaseErrorResponse(readError);
    if (!employee) return NextResponse.json({ error: "No se encontró el empleado." }, { status: 404 });
    return NextResponse.json(employee);
  } catch (error) {
    console.error("Error inesperado al actualizar empleado:", error);
    if (error instanceof BadJsonError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportServerIncident("api · actualizar empleado", error);
    return NextResponse.json({ error: "No se pudo actualizar el empleado." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;

  const parsedId = employeeIdSchema.safeParse((await context.params).id);
  if (!parsedId.success) return invalidId();
  const employeeId = parsedId.data;

  try {
    // empleados_creditos referencia al empleado: primero se eliminan sus créditos.
    const { error: creditsError } = await auth.client
      .from("empleados_creditos")
      .delete()
      .eq("id_empleado", employeeId);
    if (creditsError) return databaseErrorResponse(creditsError);

    const { error } = await auth.client.from("empleados").delete().eq("id_empleado", employeeId);
    if (error) return databaseErrorResponse(error);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error inesperado al eliminar empleado:", error);
    reportServerIncident("api · eliminar empleado", error);
    return NextResponse.json({ error: "No se pudo eliminar el empleado." }, { status: 500 });
  }
}

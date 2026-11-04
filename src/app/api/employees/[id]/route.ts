import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, databaseErrorResponse, getAuthenticatedClient, readJson } from "../_server";
import { employeePatchSchema } from "../validation";

type RouteContext = { params: Promise<{ id: string }> };

// Expediente completo de un empleado (se pide solo al abrirlo, no en la lista).
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request, "employees.view");
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "El identificador del empleado no es válido." }, { status: 400 });
  }

  try {
    const { data, error } = await auth.client.from("employees").select("*").eq("id", id).maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) return NextResponse.json({ error: "No se encontró el empleado." }, { status: 404 });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error inesperado al consultar empleado:", error);
    reportServerIncident("api · consultar empleado", error);
    return NextResponse.json({ error: "No se pudo cargar el expediente." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request, "employees.edit");
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "El identificador del empleado no es válido." }, { status: 400 });
  }

  try {
    const input = employeePatchSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json(
        { error: "Revisa los campos enviados y sus formatos." },
        { status: 400 },
      );
    }

    const { data, error } = await auth.client
      .from("employees")
      .update(input.data)
      .eq("id", id)
      .select("*")
      .single();

    if (error) return databaseErrorResponse(error);
    return NextResponse.json(data);
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
  const auth = await getAuthenticatedClient(request, "employees.delete");
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "El identificador del empleado no es válido." }, { status: 400 });
  }

  try {
    const { error } = await auth.client.from("employees").delete().eq("id", id);
    if (error) return databaseErrorResponse(error);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    console.error("Error inesperado al eliminar empleado:", error);
    reportServerIncident("api · eliminar empleado", error);
    return NextResponse.json({ error: "No se pudo eliminar el empleado." }, { status: 500 });
  }
}

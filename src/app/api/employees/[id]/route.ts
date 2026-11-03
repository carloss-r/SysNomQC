import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { databaseErrorResponse, getAuthenticatedClient, readJson } from "../_server";
import { employeePatchSchema } from "../validation";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request);
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
    const message = error instanceof Error ? error.message : "No se pudo actualizar el empleado.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request);
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
    return NextResponse.json({ error: "No se pudo eliminar el empleado." }, { status: 500 });
  }
}

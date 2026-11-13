import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, databaseErrorResponse, getAuthenticatedClient, readJson } from "../../_server";
import { terminationSchema } from "../../validation";

type RouteContext = { params: Promise<{ id: string }> };

const invalidId = () => NextResponse.json({ error: "El identificador del empleado no es válido." }, { status: 400 });

// Dar de baja: día de baja (capturado) y motivo opcional. La fecha de registro en el sistema y quién
// la registró los sella la base (trigger employees_termination_guard), no el navegador.
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request, "employees.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return invalidId();

  try {
    const input = terminationSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Escribe un día de baja válido." }, { status: 400 });

    const { data: current, error: readError } = await auth.client
      .from("employees")
      .select("hire_date,termination_date")
      .eq("id", id)
      .maybeSingle();
    if (readError) return databaseErrorResponse(readError);
    if (!current) return NextResponse.json({ error: "No se encontró el empleado." }, { status: 404 });
    if (current.termination_date) return NextResponse.json({ error: "El trabajador ya está dado de baja." }, { status: 409 });
    if (input.data.termination_date < current.hire_date) {
      return NextResponse.json({ error: "El día de baja no puede ser anterior a la fecha de contratación." }, { status: 400 });
    }

    const { data, error } = await auth.client
      .from("employees")
      .update({
        active: false,
        termination_date: input.data.termination_date,
        termination_reason: input.data.termination_reason || null,
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) return databaseErrorResponse(error);
    await recordAudit(request, auth.access, "employee.terminate", id, {
      code: data.employee_code,
      termination_date: input.data.termination_date,
    });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Error inesperado al dar de baja:", error);
    reportServerIncident("api · baja de empleado", error);
    return NextResponse.json({ error: "No se pudo registrar la baja." }, { status: 500 });
  }
}

// Reactivar: quita la baja y deja al trabajador activo.
export async function DELETE(request: NextRequest, context: RouteContext) {
  const auth = await getAuthenticatedClient(request, "employees.edit");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return invalidId();

  try {
    const { data, error } = await auth.client
      .from("employees")
      .update({ active: true, termination_date: null, termination_reason: null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) return databaseErrorResponse(error);
    await recordAudit(request, auth.access, "employee.reactivate", id, { code: data.employee_code });
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error inesperado al reactivar:", error);
    reportServerIncident("api · reactivar empleado", error);
    return NextResponse.json({ error: "No se pudo reactivar al trabajador." }, { status: 500 });
  }
}

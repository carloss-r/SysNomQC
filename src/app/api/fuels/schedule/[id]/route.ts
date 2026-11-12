import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../employees/_server";
import { cancelSchema, fuelDatabaseError, parseId } from "../../_shared";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedClient(request, "fuels.schedule");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "La recepción programada no es válida." }, { status: 400 });
  try {
    const input = cancelSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Explica el motivo de la cancelación." }, { status: 400 });
    const { error } = await auth.client.rpc("fuel_schedule_cancel", { p_id: id, p_reason: input.data.reason });
    if (error) return fuelDatabaseError(error, "cancelar programación");
    await recordAudit(request, auth.access, "fuels.schedule.cancel", id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · combustibles · cancelar programación", error);
    return NextResponse.json({ error: "No se pudo cancelar." }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import type { FuelMonthSummary } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../employees/_server";
import { fuelDatabaseError, notifyEcology, parseId, receptionActionSchema } from "../../_shared";

// M3 · Capturar salida (tara, cierre irreversible), cancelar ticket en planta o capturar el cloro de laboratorio.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedClient(request, "fuels.view");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "El ticket no es válido." }, { status: 400 });
  try {
    const input = receptionActionSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los datos capturados." }, { status: 400 });
    const action = input.data;
    const can = (key: string) => auth.access.permissions.includes(key as never);
    const allowed = action.action === "chlorine" ? can("fuels.scale") || can("fuels.suppliers") : can("fuels.scale");
    if (!allowed) return NextResponse.json({ error: "Tu rol no tiene permiso para operar la báscula." }, { status: 403 });

    if (action.action === "exit") {
      const { data, error } = await auth.client.rpc("fuel_scale_exit", {
        p_id: id,
        p_tare_kg: action.tare_kg,
        p_chlorine: action.chlorine_pct ?? null,
        p_compensates: action.compensates_id ?? null,
      });
      if (error) return fuelDatabaseError(error, "salida de báscula");
      const result = data as { id: number; net_kg: number; summary: FuelMonthSummary };
      await recordAudit(request, auth.access, "fuels.scale.exit", id, { net_kg: result.net_kg, compensates: action.compensates_id ?? null });
      notifyEcology(auth.client, result.summary, auth.access.full_name || auth.access.email);
      return NextResponse.json(result);
    }
    if (action.action === "cancel") {
      const { error } = await auth.client.rpc("fuel_scale_cancel", { p_id: id, p_reason: action.reason });
      if (error) return fuelDatabaseError(error, "cancelar ticket");
      await recordAudit(request, auth.access, "fuels.scale.cancel", id);
      return NextResponse.json({ ok: true });
    }
    const { error } = await auth.client.rpc("fuel_set_chlorine", { p_id: id, p_chlorine: action.chlorine_pct });
    if (error) return fuelDatabaseError(error, "cloro de laboratorio");
    await recordAudit(request, auth.access, "fuels.scale.chlorine", id, { chlorine_pct: action.chlorine_pct });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · combustibles · ticket", error);
    return NextResponse.json({ error: "No se pudo actualizar el ticket." }, { status: 500 });
  }
}

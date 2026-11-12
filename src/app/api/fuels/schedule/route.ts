import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import type { FuelMonthSummary } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { fuelDatabaseError, scheduleSchema } from "../_shared";

// M2: la base solo acepta proveedores y productos aprobados y vigentes, y bloquea si la proyección llega al 30 %.
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "fuels.schedule");
  if ("response" in auth) return auth.response;
  try {
    const input = scheduleSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa la fecha, el producto, el transportista y el peso." }, { status: 400 });
    const { data, error } = await auth.client.rpc("fuel_schedule_add", {
      p_date: input.data.scheduled_on,
      p_product: input.data.product_id,
      p_carrier: input.data.carrier,
      p_tons: input.data.estimated_tons,
      p_notes: input.data.notes ?? null,
    });
    if (error) return fuelDatabaseError(error, "programar");
    const result = data as { id: number; summary: FuelMonthSummary };
    await recordAudit(request, auth.access, "fuels.schedule.create", result.id, { date: input.data.scheduled_on, tons: input.data.estimated_tons });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · combustibles · programar", error);
    return NextResponse.json({ error: "No se pudo programar la recepción." }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { entrySchema, fuelDatabaseError } from "../_shared";

// M3 · Capturar entrada (bruto): abre el ticket de báscula amarrado al folio del manifiesto.
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "fuels.scale");
  if ("response" in auth) return auth.response;
  try {
    const input = entrySchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa el manifiesto, el vehículo y el peso bruto." }, { status: 400 });
    const row = input.data;
    const { data, error } = await auth.client.rpc("fuel_scale_entry", {
      p_schedule: row.schedule_id,
      p_manifest: row.manifest_folio,
      p_carrier: row.carrier,
      p_driver: row.driver,
      p_plates: row.plates,
      p_vehicle: row.vehicle ?? null,
      p_destination: row.destination ?? null,
      p_gross_kg: row.gross_kg,
      p_notes: row.notes ?? null,
    });
    if (error) return fuelDatabaseError(error, "entrada de báscula");
    await recordAudit(request, auth.access, "fuels.scale.entry", data as number, { gross_kg: row.gross_kg });
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · combustibles · entrada", error);
    return NextResponse.json({ error: "No se pudo registrar la entrada." }, { status: 500 });
  }
}

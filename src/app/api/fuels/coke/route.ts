import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import type { FuelMonthSummary } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { cokeSchema, fuelDatabaseError, notifyEcology } from "../_shared";

// M5: consumo mensual de coque de petróleo (t). Recalcula el semáforo del mes.
export async function PUT(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "fuels.ecology");
  if ("response" in auth) return auth.response;
  try {
    const input = cokeSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa el mes y las toneladas." }, { status: 400 });
    const { data, error } = await auth.client.rpc("fuel_set_coke", {
      p_month: `${input.data.month}-01`,
      p_tons: input.data.coke_tons,
      p_notes: input.data.notes ?? null,
    });
    if (error) return fuelDatabaseError(error, "consumo de coque");
    await recordAudit(request, auth.access, "fuels.coke.set", input.data.month, { coke_tons: input.data.coke_tons });
    const summary = data as FuelMonthSummary;
    notifyEcology(auth.client, summary, auth.access.full_name || auth.access.email);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · combustibles · coque", error);
    return NextResponse.json({ error: "No se pudo guardar el consumo de coque." }, { status: 500 });
  }
}

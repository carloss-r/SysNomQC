import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../employees/_server";
import { commercialSchema, fuelDatabaseError, parseId } from "../../_shared";

// M4: esquema (cobro / pago / valor 0) y tarifa por tonelada. Aplica a los tickets que se cierren después.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedClient(request, "fuels.commercial");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "El producto no es válido." }, { status: 400 });
  try {
    const input = commercialSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa el esquema y la tarifa." }, { status: 400 });
    const { error } = await auth.client.rpc("fuel_set_commercial", {
      p_product: id,
      p_scheme: input.data.scheme,
      p_rate: input.data.rate_per_ton,
    });
    if (error) return fuelDatabaseError(error, "tarifa");
    await recordAudit(request, auth.access, "fuels.product.commercial", id, input.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · combustibles · tarifa", error);
    return NextResponse.json({ error: "No se pudo guardar la tarifa." }, { status: 500 });
  }
}

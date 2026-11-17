import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../employees/_server";
import { directPurchaseSchema, eppDatabaseError, resolveSite } from "../../_shared";

/**
 * Compra directa: Compras registra lo que compró sin solicitud previa. Queda "por contar" y la sede la
 * cuenta a ciegas; solo lo contado entra al inventario. epp_direct_purchase() vuelve a validar permiso y sede.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.purchase");
  if ("response" in auth) return auth.response;
  try {
    const input = directPurchaseSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los artículos y cantidades." }, { status: 400 });
    const resolved = resolveSite(auth.access, input.data.site);
    if ("response" in resolved) return resolved.response;

    const { data, error } = await auth.client.rpc("epp_direct_purchase", {
      p_site: resolved.site,
      p_items: input.data.items,
      p_note: input.data.notes ?? null,
    });
    if (error) return eppDatabaseError(error, "registrar compra directa");
    // Solo el número de renglones: las cantidades compradas no van a la bitácora (el conteo es ciego).
    await recordAudit(request, auth.access, "epp.purchase.direct", data as number, {
      site: resolved.site,
      items: input.data.items.length,
    });
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · compra directa", error);
    return NextResponse.json({ error: "No se pudo registrar la compra directa." }, { status: 500 });
  }
}

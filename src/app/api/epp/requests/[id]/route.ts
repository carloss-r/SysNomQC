import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../employees/_server";
import { eppDatabaseError, purchaseStatusSchema } from "../../_shared";

// Cambia el estado de una solicitud. Quién puede hacer qué lo decide epp_update_purchase() en la base.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
  }
  try {
    const input = purchaseStatusSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Estado no válido." }, { status: 400 });
    const { data, error } = await auth.client.rpc("epp_update_purchase", {
      p_id: id,
      p_status: input.data.status,
      p_note: input.data.note ?? null,
    });
    if (error) return eppDatabaseError(error, "actualizar solicitud");
    await recordAudit(request, auth.access, `epp.purchase.${input.data.status}`, id);
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · actualizar solicitud", error);
    return NextResponse.json({ error: "No se pudo actualizar la solicitud." }, { status: 500 });
  }
}

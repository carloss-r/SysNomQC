import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { SITES } from "@/lib/employees";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { eppDatabaseError, purchaseRequestSchema, resolveSite } from "../_shared";
import { readPurchaseRequests } from "./_read";

// Compras ve las de todas las sedes (o filtra con ?site=); una sede solo ve las suyas.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  const { access } = auth;
  const canSee = ["epp.purchase", "epp.request", "epp.manage"].some((key) => access.permissions.includes(key as never));
  if (!canSee) return NextResponse.json({ error: "Tu rol no tiene permiso para ver las solicitudes." }, { status: 403 });

  const requested = request.nextUrl.searchParams.get("site");
  const buyer = access.permissions.includes("epp.purchase");
  let site: string | null = null;
  if (access.site && !access.is_super_admin && !buyer) site = access.site;
  else if (requested && (SITES as readonly string[]).includes(requested)) site = requested;

  try {
    const { error, requests } = await readPurchaseRequests(auth.client, { site });
    if (error) return eppDatabaseError(error, "listar solicitudes");
    return NextResponse.json(requests);
  } catch (error) {
    reportServerIncident("api · epp · solicitudes", error);
    return NextResponse.json({ error: "No se pudieron cargar las solicitudes." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.request");
  if ("response" in auth) return auth.response;
  try {
    const input = purchaseRequestSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los artículos y cantidades." }, { status: 400 });
    const resolved = resolveSite(auth.access, input.data.site);
    if ("response" in resolved) return resolved.response;

    const { data, error } = await auth.client.rpc("epp_request_purchase", {
      p_site: resolved.site,
      p_items: input.data.items,
      p_notes: input.data.notes ?? null,
    });
    if (error) return eppDatabaseError(error, "crear solicitud");
    await recordAudit(request, auth.access, "epp.purchase.request", data as number, {
      site: resolved.site,
      items: input.data.items.length,
    });
    return NextResponse.json({ id: data }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · crear solicitud", error);
    return NextResponse.json({ error: "No se pudo crear la solicitud." }, { status: 500 });
  }
}

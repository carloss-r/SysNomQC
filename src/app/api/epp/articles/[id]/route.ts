import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../employees/_server";
import { articleSchema, eppDatabaseError, resolveSite } from "../../_shared";

// Edita el catálogo (común a las sedes) y el mínimo de la sede indicada.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await getAuthenticatedClient(request, "epp.manage");
  if ("response" in auth) return auth.response;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: "El artículo no es válido." }, { status: 400 });
  }
  try {
    const input = articleSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los datos del artículo." }, { status: 400 });
    const { site: requestedSite, min_stock, ...catalog } = input.data;
    const resolved = resolveSite(auth.access, requestedSite);
    if ("response" in resolved) return resolved.response;

    const { data, error } = await auth.client.from("epp_articles").update(catalog).eq("id", id).select("id,name").single();
    if (error) return eppDatabaseError(error, "editar artículo");
    const { error: minError } = await auth.client.rpc("epp_set_min_stock", { p_site: resolved.site, p_article: id, p_min: min_stock });
    if (minError) return eppDatabaseError(minError, "mínimo por sede");

    await recordAudit(request, auth.access, "epp.article.update", id, { name: data.name, site: resolved.site });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · editar artículo", error);
    return NextResponse.json({ error: "No se pudo actualizar el artículo." }, { status: 500 });
  }
}

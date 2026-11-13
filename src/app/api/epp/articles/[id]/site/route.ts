import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { SITES } from "@/lib/employees";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../../employees/_server";
import { eppDatabaseError, resolveSite } from "../../../_shared";

type Context = { params: Promise<{ id: string }> };

const addSchema = z.object({ site: z.enum(SITES), min_stock: z.number().int().min(0).max(100000).default(5) }).strict();

async function articleId(context: Context) {
  const id = Number((await context.params).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Agrega un artículo del catálogo al inventario de una sede (existencia 0 y su mínimo).
export async function POST(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "epp.manage");
  if ("response" in auth) return auth.response;
  const id = await articleId(context);
  if (!id) return NextResponse.json({ error: "El artículo no es válido." }, { status: 400 });
  try {
    const input = addSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa la sede y el mínimo." }, { status: 400 });
    const resolved = resolveSite(auth.access, input.data.site);
    if ("response" in resolved) return resolved.response;
    const { error } = await auth.client.rpc("epp_set_min_stock", { p_site: resolved.site, p_article: id, p_min: input.data.min_stock });
    if (error) return eppDatabaseError(error, "agregar a la sede");
    await recordAudit(request, auth.access, "epp.article.site_add", id, { site: resolved.site });
    return NextResponse.json({ id, site: resolved.site }, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · agregar a la sede", error);
    return NextResponse.json({ error: "No se pudo agregar el artículo a la sede." }, { status: 500 });
  }
}

// Quita el artículo del inventario de una sede (?site=). Solo sin existencia ni solicitudes abiertas.
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "epp.manage");
  if ("response" in auth) return auth.response;
  const id = await articleId(context);
  if (!id) return NextResponse.json({ error: "El artículo no es válido." }, { status: 400 });
  const resolved = resolveSite(auth.access, request.nextUrl.searchParams.get("site"));
  if ("response" in resolved) return resolved.response;
  try {
    const { error } = await auth.client.rpc("epp_remove_from_site", { p_site: resolved.site, p_article: id });
    if (error) return eppDatabaseError(error, "quitar de la sede");
    await recordAudit(request, auth.access, "epp.article.site_remove", id, { site: resolved.site });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    reportServerIncident("api · epp · quitar de la sede", error);
    return NextResponse.json({ error: "No se pudo quitar el artículo de la sede." }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../../employees/_server";
import { articleSchema, eppDatabaseError } from "../../_shared";

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
    const { data, error } = await auth.client.from("epp_articles").update(input.data).eq("id", id).select("*").single();
    if (error) return eppDatabaseError(error, "editar artículo");
    await recordAudit(request, auth.access, "epp.article.update", id, { name: data.name });
    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · editar artículo", error);
    return NextResponse.json({ error: "No se pudo actualizar el artículo." }, { status: 500 });
  }
}

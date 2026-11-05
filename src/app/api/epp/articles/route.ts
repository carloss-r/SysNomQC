import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { articleSchema, eppDatabaseError } from "../_shared";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  try {
    const { data, error } = await auth.client
      .from("epp_articles")
      .select("id,name,category,size,unit,stock,min_stock,active,updated_at,updated_by_name")
      .order("category")
      .order("name")
      .limit(1000);
    if (error) return eppDatabaseError(error, "listar");
    return NextResponse.json(data);
  } catch (error) {
    reportServerIncident("api · epp · listar", error);
    return NextResponse.json({ error: "No se pudo cargar el inventario." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.manage");
  if ("response" in auth) return auth.response;
  try {
    const input = articleSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los datos del artículo." }, { status: 400 });
    const { data, error } = await auth.client.from("epp_articles").insert(input.data).select("*").single();
    if (error) return eppDatabaseError(error, "crear artículo");
    await recordAudit(request, auth.access, "epp.article.create", data.id, { name: data.name });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · crear artículo", error);
    return NextResponse.json({ error: "No se pudo crear el artículo." }, { status: 500 });
  }
}

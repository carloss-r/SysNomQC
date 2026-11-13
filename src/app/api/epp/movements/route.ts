import { NextResponse, type NextRequest } from "next/server";
import { eppArticleLabel } from "@/lib/permissions";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { eppDatabaseError, movementSchema, resolveSite } from "../_shared";

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const resolved = resolveSite(auth.access, params.get("site"));
  if ("response" in resolved) return resolved.response;
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 300) || 300, 1), 1000);
  const kind = params.get("kind");
  const employee = params.get("employee");
  const article = Number(params.get("article"));

  try {
    let query = auth.client
      .from("epp_movements")
      .select(
        "id,article_id,kind,delta,stock_after,employee_id,employee_name,employee_code,site,moved_on,notes,created_at,created_by_name,article:epp_articles(name,size)",
      )
      .eq("site", resolved.site)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (kind === "ingreso" || kind === "entrega" || kind === "ajuste") query = query.eq("kind", kind);
    if (employee && /^[0-9a-f-]{36}$/i.test(employee)) query = query.eq("employee_id", employee);
    if (Number.isSafeInteger(article) && article > 0) query = query.eq("article_id", article);

    const { data, error } = await query;
    if (error) return eppDatabaseError(error, "movimientos");
    const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
      const { article: joined, ...rest } = row;
      const found = (Array.isArray(joined) ? joined[0] : joined) as { name?: string; size?: string | null } | null | undefined;
      return { ...rest, article_name: found?.name ? eppArticleLabel(found.name, found.size) : "Artículo eliminado" };
    });
    return NextResponse.json(rows);
  } catch (error) {
    reportServerIncident("api · epp · movimientos", error);
    return NextResponse.json({ error: "No se pudo cargar el historial." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  // El permiso exacto (entrega vs. ingreso/ajuste) y la sede los vuelve a validar epp_apply_site() en la base.
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;
  try {
    const input = movementSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los artículos y cantidades." }, { status: 400 });
    const body = input.data;
    const needed = body.kind === "entrega" ? "epp.deliver" : "epp.manage";
    if (!auth.access.permissions.includes(needed)) {
      return NextResponse.json({ error: "Tu rol no tiene permiso para realizar esta acción." }, { status: 403 });
    }
    // Los ajustes cambian la existencia sin respaldo físico: solo un SuperAdmin los autoriza.
    if (body.kind === "ajuste" && !auth.access.is_super_admin) {
      return NextResponse.json({ error: "Solo un Super administrador puede ajustar el inventario." }, { status: 403 });
    }
    const resolved = resolveSite(auth.access, body.site);
    if ("response" in resolved) return resolved.response;

    const { data, error } = await auth.client.rpc("epp_apply_site", {
      p_site: resolved.site,
      p_kind: body.kind,
      p_items: body.items,
      p_employee: body.employee_id ?? null,
      // La fecha la fija la base de datos (hoy, hora de Campeche); no se toma la del navegador.
      p_date: null,
      p_notes: body.notes ?? null,
    });
    if (error) return eppDatabaseError(error, "registrar movimiento");
    await recordAudit(request, auth.access, `epp.${body.kind}`, body.employee_id ?? null, {
      items: body.items.length,
      site: resolved.site,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · registrar movimiento", error);
    return NextResponse.json({ error: "No se pudo registrar el movimiento." }, { status: 500 });
  }
}

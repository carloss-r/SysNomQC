import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import type { EppArticle } from "@/lib/permissions";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { articleSchema, eppDatabaseError, resolveSite } from "../_shared";

type CatalogRow = Omit<EppArticle, "stock" | "site" | "tracked" | "pending_count">;
type PendingRow = { id: number; items: { article_id: number; received_qty: number | null }[] | null };
type StockRow = { article_id: number; stock: number; min_stock: number; updated_at: string; updated_by_name: string | null };

// Catálogo común + existencia y mínimo de la sede pedida (?site=). Una cuenta con sede solo ve la suya.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  const resolved = resolveSite(auth.access, request.nextUrl.searchParams.get("site"));
  if ("response" in resolved) return resolved.response;
  const { site } = resolved;

  try {
    const [catalog, stock, counts] = await Promise.all([
      auth.client
        .from("epp_articles")
        .select("id,name,category,size,unit,min_stock,active,updated_at,updated_by_name")
        .order("category")
        .order("name")
        .order("size", { nullsFirst: true })
        .limit(1000),
      auth.client.from("epp_stock").select("article_id,stock,min_stock,updated_at,updated_by_name").eq("site", site).limit(1000),
      // Compras registradas sin contar: esos artículos no se mueven hasta el conteo.
      auth.client
        .from("epp_purchase_requests")
        .select("id,items:epp_purchase_request_items(article_id,received_qty)")
        .eq("site", site)
        .eq("status", "en_compra")
        .order("id")
        .limit(500),
    ]);
    if (catalog.error) return eppDatabaseError(catalog.error, "listar");
    if (stock.error) return eppDatabaseError(stock.error, "existencias por sede");
    if (counts.error) return eppDatabaseError(counts.error, "conteos pendientes");

    const pending = new Map<number, number>();
    for (const row of counts.data as PendingRow[]) {
      for (const item of row.items ?? []) if (item.received_qty === null && !pending.has(item.article_id)) pending.set(item.article_id, row.id);
    }

    const bySite = new Map((stock.data as StockRow[]).map((row) => [row.article_id, row]));
    const articles: EppArticle[] = (catalog.data as CatalogRow[]).map((item) => {
      const own = bySite.get(item.id);
      return {
        ...item,
        site,
        tracked: Boolean(own),
        stock: own?.stock ?? 0,
        min_stock: own?.min_stock ?? item.min_stock,
        updated_at: own?.updated_at ?? item.updated_at,
        updated_by_name: own?.updated_by_name ?? item.updated_by_name,
        pending_count: pending.get(item.id) ?? null,
      };
    });
    return NextResponse.json(articles);
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
    const { site: requestedSite, ...fields } = input.data;
    const { data, error } = await auth.client.from("epp_articles").insert(fields).select("id,name").single();
    if (error) return eppDatabaseError(error, "crear artículo");

    // El mínimo capturado queda como el de la sede donde se creó.
    const resolved = resolveSite(auth.access, requestedSite);
    if (!("response" in resolved)) {
      const { error: minError } = await auth.client.rpc("epp_set_min_stock", {
        p_site: resolved.site,
        p_article: data.id,
        p_min: fields.min_stock,
      });
      if (minError) return eppDatabaseError(minError, "mínimo por sede");
    }
    await recordAudit(request, auth.access, "epp.article.create", data.id, { name: data.name });
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · epp · crear artículo", error);
    return NextResponse.json({ error: "No se pudo crear el artículo." }, { status: 500 });
  }
}

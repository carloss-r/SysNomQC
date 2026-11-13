import { NextResponse, type NextRequest } from "next/server";
import { eppArticleLabel } from "@/lib/permissions";
import { reportServerIncident } from "@/lib/incidents";
import { getAuthenticatedClient } from "../../employees/_server";
import { eppDatabaseError, resolveSite } from "../_shared";

const PAGE = 1000;
const MAX_ROWS = 20000;
const COLUMNS =
  "id,article_id,kind,delta,stock_after,employee_id,employee_name,employee_code,employee_group,employee_position,site,moved_on,notes,created_at,created_by_name,historical,article:epp_articles(name,size)";

// Libro completo de movimientos (entregas, ingresos y ajustes) para el historial, el control mensual y
// la ficha por trabajador. Se pagina de 1000 en 1000 porque PostgREST limita cada respuesta.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  const resolved = resolveSite(auth.access, request.nextUrl.searchParams.get("site"));
  if ("response" in resolved) return resolved.response;
  try {
    const rows: Array<Record<string, unknown>> = [];
    for (let from = 0; from < MAX_ROWS; from += PAGE) {
      const { data, error } = await auth.client
        .from("epp_movements")
        .select(COLUMNS)
        .eq("site", resolved.site)
        .order("moved_on", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) return eppDatabaseError(error, "libro de movimientos");
      rows.push(...((data ?? []) as unknown as Array<Record<string, unknown>>));
      if ((data?.length ?? 0) < PAGE) break;
    }
    return NextResponse.json(
      rows.map((row) => {
        const { article: joined, ...rest } = row;
        const found = (Array.isArray(joined) ? joined[0] : joined) as { name?: string; size?: string | null } | null | undefined;
        return { ...rest, article_name: found?.name ? eppArticleLabel(found.name, found.size) : "Artículo eliminado" };
      }),
    );
  } catch (error) {
    reportServerIncident("api · epp · libro", error);
    return NextResponse.json({ error: "No se pudo cargar el historial." }, { status: 500 });
  }
}

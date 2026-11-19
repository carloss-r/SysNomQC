import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eppArticleLabel, type EppMovement } from "@/lib/permissions";
import { reportServerIncident } from "@/lib/incidents";
import { searchTerm } from "@/lib/safe-input";
import { getAuthenticatedClient } from "../../employees/_server";
import { eppDatabaseError, resolveSite } from "../_shared";

const COLUMNS =
  "id,article_id,kind,delta,stock_after,employee_id,employee_name,employee_code,employee_group,employee_position,employee_key,site,moved_on,notes,created_at,created_by_name,historical,article:epp_articles(name,size)";
/** PostgREST devuelve como máximo 1000 filas por respuesta. */
const CHUNK = 1000;
/** Tope de filas para un mes o un trabajador (un mes normal de una sede son unos cientos). */
const MAX_ROWS = 10_000;
const PAGE_DEFAULT = 50;
const PAGE_MAX = 200;
const KINDS = ["entrega", "ingreso", "ajuste"] as const;

type Row = Record<string, unknown> & { article?: unknown };

function toMovement(row: Row): EppMovement {
  const { article: joined, ...rest } = row;
  const found = (Array.isArray(joined) ? joined[0] : joined) as { name?: string; size?: string | null } | null | undefined;
  return { ...(rest as unknown as EppMovement), article_name: found?.name ? eppArticleLabel(found.name, found.size) : "Artículo eliminado" };
}

/** Quita lo que rompería el filtro or() de PostgREST (comas, paréntesis, comodines). */
// Solo letras, números, espacios y guiones: el texto va dentro de un filtro .or() de PostgREST.
function cleanTerm(value: string | null) {
  return searchTerm(value);
}

function monthRange(month: string) {
  const [year, mon] = month.split("-").map(Number);
  const next = mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
  return { from: `${month}-01`, to: `${next}-01` };
}

/**
 * Movimientos de EPP de una sede. Ya no se descarga el libro completo: cada pantalla pide lo suyo.
 *   ?month=YYYY-MM            Todo el mes (control mensual).
 *   ?worker=KEY[&month=…]     Entregas de un trabajador (employee_key).
 *   (sin los anteriores)      Historial por páginas: ?page=0&size=50&kind=entrega&q=texto
 * Respuesta: { rows, total }.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const resolved = resolveSite(auth.access, params.get("site"));
  if ("response" in resolved) return resolved.response;
  const { site } = resolved;

  const month = params.get("month");
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "Mes no válido." }, { status: 400 });
  const worker = params.get("worker");
  if (worker !== null && (worker.length === 0 || worker.length > 200)) return NextResponse.json({ error: "Trabajador no válido." }, { status: 400 });

  try {
    if (month || worker) return await readAll(auth.client, site, month, worker);
    return await readPage(auth.client, site, params);
  } catch (error) {
    reportServerIncident("api · epp · libro", error);
    return NextResponse.json({ error: "No se pudo cargar el historial." }, { status: 500 });
  }
}

async function readAll(client: SupabaseClient, site: string, month: string | null, worker: string | null) {
  const rows: EppMovement[] = [];
  for (let from = 0; from < MAX_ROWS; from += CHUNK) {
    let query = client.from("epp_movements").select(COLUMNS).eq("site", site);
    if (worker) query = query.eq("kind", "entrega").eq("employee_key", worker);
    if (month) {
      const range = monthRange(month);
      query = query.gte("moved_on", range.from).lt("moved_on", range.to);
    }
    const { data, error } = await query
      .order("moved_on", { ascending: false })
      .order("id", { ascending: false })
      .range(from, from + CHUNK - 1);
    if (error) return eppDatabaseError(error, "libro de movimientos");
    rows.push(...((data ?? []) as Row[]).map(toMovement));
    if ((data?.length ?? 0) < CHUNK) break;
  }
  return NextResponse.json({ rows, total: rows.length });
}

async function readPage(client: SupabaseClient, site: string, params: URLSearchParams) {
  const size = Math.min(PAGE_MAX, Math.max(1, Number(params.get("size")) || PAGE_DEFAULT));
  const page = Math.max(0, Math.floor(Number(params.get("page")) || 0));
  const kind = params.get("kind");
  const term = cleanTerm(params.get("q"));

  let query = client.from("epp_movements").select(COLUMNS, { count: "exact" }).eq("site", site);
  if (kind && (KINDS as readonly string[]).includes(kind)) query = query.eq("kind", kind);
  if (term) {
    // El nombre del artículo vive en epp_articles: se buscan sus ids y se suman al filtro.
    const like = `*${term}*`;
    const { data: matches, error } = await client
      .from("epp_articles")
      .select("id")
      .eq("site", site)
      .or(`name.ilike.${like},size.ilike.${like}`)
      .limit(200);
    if (error) return eppDatabaseError(error, "buscar artículos");
    const ids = (matches ?? []).map((item) => item.id as number);
    const filters = [
      `employee_name.ilike.${like}`,
      `employee_code.ilike.${like}`,
      `created_by_name.ilike.${like}`,
      `notes.ilike.${like}`,
    ];
    if (ids.length > 0) filters.push(`article_id.in.(${ids.join(",")})`);
    query = query.or(filters.join(","));
  }

  const { data, error, count } = await query
    .order("moved_on", { ascending: false })
    .order("id", { ascending: false })
    .range(page * size, page * size + size - 1);
  // Página fuera de rango (la lista se achicó mientras se veía): se devuelve vacía y la pantalla regresa a la primera.
  if (error?.code === "PGRST103") return NextResponse.json({ rows: [], total: 0 });
  if (error) return eppDatabaseError(error, "libro de movimientos");
  return NextResponse.json({ rows: ((data ?? []) as Row[]).map(toMovement), total: count ?? 0 });
}

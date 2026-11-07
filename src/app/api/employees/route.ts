import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import { EMPLOYEE_LIST_COLUMNS, SITES } from "@/lib/employees";
import { BadJsonError, databaseErrorResponse, getAuthenticatedClient, readJson } from "./_server";
import { employeeInputSchema } from "./validation";

// Filtro de texto para .or(): se quitan comodines y separadores de PostgREST para que lo
// escrito por el usuario no pueda alterar la consulta.
function searchFilter(raw: string | null) {
  const text = (raw ?? "").replace(/[%_,()"\\*]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!text) return null;
  return ["full_name", "employee_code", "position", "email"]
    .map((column) => `${column}.ilike.%${text}%`)
    .join(",");
}

export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "employees.view");
  if ("response" in auth) return auth.response;

  const params = request.nextUrl.searchParams;
  const offsetValue = Number(params.get("offset") ?? 0);
  const limitValue = Number(params.get("limit") ?? 500);
  const offset = Number.isSafeInteger(offsetValue) && offsetValue >= 0 ? offsetValue : 0;
  const limit = Number.isSafeInteger(limitValue) ? Math.min(Math.max(limitValue, 1), 500) : 500;

  try {
    // ?next_code=1 → siguiente ID sugerido (QG-n). Lee solo la columna del código y solo se pide
    // al abrir "Registrar empleado", porque la lista paginada no tiene todos los códigos.
    if (params.get("next_code") === "1") {
      const CHUNK = 1000;
      let highest = 100;
      for (let from = 0; ; from += CHUNK) {
        const { data: codes, error: codesError } = await auth.client
          .from("employees")
          .select("employee_code")
          .order("employee_code")
          .range(from, from + CHUNK - 1);
        if (codesError) return databaseErrorResponse(codesError);
        for (const row of codes) {
          highest = Math.max(highest, Number(row.employee_code.match(/(\d+)$/)?.[1] ?? 0));
        }
        if (codes.length < CHUNK) break;
      }
      return NextResponse.json({ next_code: `QG-${highest + 1}` });
    }

    // ?stats=1 → solo conteos (sin traer filas) para los contadores de la pantalla.
    if (params.get("stats") === "1") {
      const countSite = (site?: string) => {
        const query = auth.client.from("employees").select("id", { count: "exact", head: true });
        return site ? query.eq("site", site) : query;
      };
      const results = await Promise.all([countSite(), ...SITES.map((site) => countSite(site))]);
      const failed = results.find((result) => result.error);
      if (failed?.error) return databaseErrorResponse(failed.error);
      const [all, ...perSite] = results;
      return NextResponse.json({
        total: all.count ?? 0,
        bySite: Object.fromEntries(SITES.map((site, index) => [site, perSite[index].count ?? 0])),
      });
    }

    // ?count=1 → { data, total } con el total que coincide con los filtros (para paginar).
    const withCount = params.get("count") === "1";
    const site = params.get("site");
    const textFilter = searchFilter(params.get("search"));

    let query = auth.client
      .from("employees")
      .select(EMPLOYEE_LIST_COLUMNS, { count: withCount ? "exact" : undefined });
    if (site && (SITES as readonly string[]).includes(site)) query = query.eq("site", site);
    if (textFilter) query = query.or(textFilter);

    const { data, error, count } = await query
      .order("full_name")
      .order("id")
      .range(offset, offset + limit - 1);

    if (error) return databaseErrorResponse(error);
    return NextResponse.json(withCount ? { data, total: count ?? 0 } : data);
  } catch (error) {
    console.error("Error inesperado al consultar empleados:", error);
    reportServerIncident("api · listar empleados", error);
    return NextResponse.json({ error: "No se pudo cargar el directorio." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "employees.create");
  if ("response" in auth) return auth.response;

  try {
    const input = employeeInputSchema.safeParse(await readJson(request));
    if (!input.success) {
      return NextResponse.json(
        { error: "Revisa los campos obligatorios y el formato de los datos." },
        { status: 400 },
      );
    }

    const { data, error } = await auth.client
      .from("employees")
      .insert(input.data)
      .select("*")
      .single();

    if (error) return databaseErrorResponse(error);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error("Error inesperado al crear empleado:", error);
    if (error instanceof BadJsonError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    reportServerIncident("api · crear empleado", error);
    return NextResponse.json({ error: "No se pudo crear el empleado." }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import { EMPLOYEE_DETAIL_SELECT, EMPLOYEE_FOLLOWUP_COLUMNS, EMPLOYEE_LIST_COLUMNS, SITES } from "@/lib/employees";
import { BadJsonError, databaseErrorResponse, getAuthenticatedClient, readJson } from "./_server";
import { searchTerm } from "@/lib/safe-input";
import { employeeInputSchema, employeeValidationMessage } from "./validation";

/** Id numérico de catálogo (área, puesto, asignación) leído de la URL; null si no viene o no es válido. */
function catalogId(raw: string | null) {
  if (!raw || !/^\d{1,12}$/.test(raw)) return null;
  return Number(raw);
}

// Filtro de texto para .or(): searchTerm deja solo letras, números, espacios y guiones, así lo escrito
// por el usuario no puede alterar la consulta (comas, paréntesis, puntos y comodines quedan fuera).
function searchFilter(raw: string | null) {
  const text = searchTerm(raw);
  if (!text) return null;
  return ["full_name", "employee_code", "position", "assignment", "email"]
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
    // Lo calcula la base en una consulta (employee_next_code); antes se descargaban todos los códigos.
    if (params.get("next_code") === "1") {
      const { data: nextCode, error: codeError } = await auth.client.rpc("employee_next_code");
      if (codeError) return databaseErrorResponse(codeError);
      return NextResponse.json({ next_code: nextCode as string });
    }

    // ?stats=1 → solo conteos (sin traer filas) para los contadores de la pantalla.
    // Los contadores cuentan solo trabajadores activos: una baja los hace bajar.
    // Una sola consulta a la vista employee_site_counts (antes eran 6 conteos por separado).
    if (params.get("stats") === "1") {
      const { data: counts, error: countsError } = await auth.client
        .from("employee_site_counts")
        .select("site,active,follow_up");
      if (countsError) return databaseErrorResponse(countsError);
      const rows = (counts ?? []) as { site: string; active: number; follow_up: number }[];
      const bySite = Object.fromEntries(SITES.map((site) => [site, rows.find((row) => row.site === site)?.active ?? 0]));
      return NextResponse.json({
        total: rows.reduce((sum, row) => sum + row.active, 0),
        bySite,
        followUp: rows.reduce((sum, row) => sum + row.follow_up, 0),
      });
    }

    // ?count=1 → { data, total } con el total que coincide con los filtros (para paginar).
    const withCount = params.get("count") === "1";
    const site = params.get("site");
    const textFilter = searchFilter(params.get("search"));

    // ?seguimiento=1 → solo expedientes con observaciones, con el texto y quién lo escribió.
    const followUp = params.get("seguimiento") === "1";
    // ?estatus=activos | bajas → solo activos o solo dados de baja (sin el parámetro: todos).
    const status = params.get("estatus");
    // ?area=<id> · ?puesto=<id> · ?asignacion=<id> | sin → filtros por catálogo (todos usan índice).
    const area = catalogId(params.get("area"));
    const position = catalogId(params.get("puesto"));
    const assignmentParam = params.get("asignacion");
    const assignment = catalogId(assignmentParam);

    let query = auth.client
      .from("employees")
      .select(followUp ? EMPLOYEE_FOLLOWUP_COLUMNS : EMPLOYEE_LIST_COLUMNS, { count: withCount ? "exact" : undefined });
    if (site && (SITES as readonly string[]).includes(site)) query = query.eq("site", site);
    if (status === "activos") query = query.eq("active", true);
    if (status === "bajas") query = query.eq("active", false);
    if (area !== null) query = query.eq("area_id", area);
    if (position !== null) query = query.eq("position_id", position);
    if (assignment !== null) query = query.eq("assignment_id", assignment);
    if (assignmentParam === "sin") query = query.is("assignment_id", null);
    if (textFilter) query = query.or(textFilter);
    if (followUp) query = query.not("observations", "is", null);

    // Bajas: las más recientes primero. Seguimiento: la observación más reciente primero.
    const ordered = followUp
      ? query.order("observations_updated_at", { ascending: false, nullsFirst: false }).order("id")
      : status === "bajas"
        ? query.order("termination_date", { ascending: false, nullsFirst: false }).order("full_name").order("id")
        : query.order("full_name").order("id");
    const { data, error, count } = await ordered.range(offset, offset + limit - 1);

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
      return NextResponse.json({ error: employeeValidationMessage(input.error) }, { status: 400 });
    }

    // El ID lo asigna el servidor (siguiente QG-n), no el formulario. Si otra persona dio de alta a alguien
    // al mismo tiempo y tomó ese número, se calcula el siguiente y se reintenta.
    let saved: { data: Record<string, unknown> | null; error: { code?: string; message: string } | null } = { data: null, error: null };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { data: nextCode, error: codeError } = await auth.client.rpc("employee_next_code");
      if (codeError) return databaseErrorResponse(codeError);
      saved = await auth.client
        .from("employees")
        .insert({ ...input.data, employee_code: nextCode as string })
        .select(EMPLOYEE_DETAIL_SELECT)
        .single();
      const codeTaken = saved.error?.code === "23505" && /employee_code/.test(saved.error.message);
      if (!codeTaken) break;
    }
    const { data, error } = saved;
    if (error || !data) return databaseErrorResponse(error ?? { message: "Sin datos" });
    await recordAudit(request, auth.access, "employee.create", data.id as string, { code: data.employee_code });
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

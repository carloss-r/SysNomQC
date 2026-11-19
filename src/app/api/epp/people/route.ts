import { NextResponse, type NextRequest } from "next/server";
import { searchTerm } from "@/lib/safe-input";
import { eppKey, type EppPerson } from "@/lib/permissions";
import { reportServerIncident } from "@/lib/incidents";
import { getAuthenticatedClient } from "../../employees/_server";
import { eppDatabaseError, resolveSite } from "../_shared";

const LIMIT = 5;

type Row = {
  employee_key: string;
  name: string;
  employee_id: string | null;
  employee_group: string | null;
  employee_position: string | null;
  pieces: number;
  deliveries: number;
  last_date: string;
};

/**
 * Trabajadores con entregas en la sede (vista epp_people, agrupada en la base).
 *   ?q=texto   Busca por nombre (cada palabra debe aparecer). Sin q: los de entregas más recientes.
 *   ?key=KEY   Un trabajador exacto (al abrirlo desde el control mensual).
 * Respuesta: { people, total } con a lo más 5 personas.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  const params = request.nextUrl.searchParams;
  const resolved = resolveSite(auth.access, params.get("site"));
  if ("response" in resolved) return resolved.response;

  const key = params.get("key");
  const tokens = eppKey(searchTerm(params.get("q"), 80))
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);

  try {
    let query = auth.client
      .from("epp_people")
      .select("employee_key,name,employee_id,employee_group,employee_position,pieces,deliveries,last_date", { count: "exact" })
      .eq("site", resolved.site);
    if (key) query = query.eq("employee_key", key.slice(0, 200));
    for (const token of tokens) query = query.ilike("employee_key", `%${token}%`);
    const { data, error, count } = await query
      .order(tokens.length ? "name" : "last_date", { ascending: tokens.length > 0 })
      .limit(LIMIT);
    if (error) return eppDatabaseError(error, "trabajadores con entregas");
    const people: EppPerson[] = ((data ?? []) as Row[]).map((row) => ({
      key: row.employee_key,
      name: row.name,
      employeeId: row.employee_id,
      group: row.employee_group,
      position: row.employee_position,
      pieces: row.pieces,
      deliveries: row.deliveries,
      lastDate: row.last_date,
    }));
    return NextResponse.json({ people, total: count ?? people.length });
  } catch (error) {
    reportServerIncident("api · epp · trabajadores con entregas", error);
    return NextResponse.json({ error: "No se pudo buscar al trabajador." }, { status: 500 });
  }
}

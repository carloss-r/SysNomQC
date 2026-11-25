import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import type { EmployeeCatalog } from "@/lib/employees";
import { databaseErrorResponse, getAuthenticatedClient } from "../_server";

// Catálogos del directorio: áreas globales (CYM / CAL), puestos y asignaciones de cada sede y área, y
// cuántos trabajadores hay en cada combinación (activos y bajas). Son pocas filas y se piden en paralelo:
// con esto la pantalla arma los filtros y sus números sin volver a consultar al cambiar de filtro.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "employees.view");
  if ("response" in auth) return auth.response;

  try {
    const [areas, positions, assignments, counts] = await Promise.all([
      auth.client.from("employee_areas").select("id,site,code,name,responsible").eq("active", true).order("sort_order").order("code"),
      auth.client.from("employee_positions").select("id,site,area_id,name").eq("active", true).order("name"),
      auth.client.from("employee_assignments").select("id,site,area_id,name").eq("active", true).order("name"),
      auth.client.from("employee_group_counts").select("site,area_id,position_id,assignment_id,active,total"),
    ]);
    const failed = areas.error ?? positions.error ?? assignments.error ?? counts.error;
    if (failed) return databaseErrorResponse(failed);

    const catalog: EmployeeCatalog = {
      areas: areas.data ?? [],
      positions: positions.data ?? [],
      assignments: assignments.data ?? [],
      counts: counts.data ?? [],
    };
    return NextResponse.json(catalog);
  } catch (error) {
    console.error("Error inesperado al consultar catálogos de empleados:", error);
    reportServerIncident("api · catálogos de empleados", error);
    return NextResponse.json({ error: "No se pudieron cargar las áreas y puestos." }, { status: 500 });
  }
}

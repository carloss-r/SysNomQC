import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import type { Catalogs } from "@/lib/employees";
import { databaseErrorResponse, getAuthenticatedClient } from "../employees/_server";

// Catálogos que alimentan los selectores del formulario (sedes, áreas, puestos, etc.).
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request);
  if ("response" in auth) return auth.response;

  try {
    const [sites, areas, positions, genders, maritalStatuses, creditTypes] = await Promise.all([
      auth.client.from("sedes").select("id_sede,nombre").eq("activo", true).order("nombre"),
      auth.client.from("areas").select("id_area,nombre").order("nombre"),
      auth.client.from("puestos").select("id_puesto,id_area,nombre").order("nombre"),
      auth.client.from("catalogos_generos").select("id_genero,nombre").order("id_genero"),
      auth.client.from("catalogos_estados_civiles").select("id_estado_civil,nombre").order("id_estado_civil"),
      auth.client.from("catalogos_tipos_credito").select("id_tipo_credito,nombre").eq("activo", true).order("nombre"),
    ]);

    const failed = [sites, areas, positions, genders, maritalStatuses, creditTypes].find((result) => result.error);
    if (failed?.error) return databaseErrorResponse(failed.error);

    const catalogs: Catalogs = {
      sites: (sites.data ?? []).map((row) => ({ id: row.id_sede, name: row.nombre })),
      areas: (areas.data ?? []).map((row) => ({ id: row.id_area, name: row.nombre })),
      positions: (positions.data ?? []).map((row) => ({
        id: row.id_puesto,
        area_id: row.id_area,
        name: row.nombre,
      })),
      genders: (genders.data ?? []).map((row) => ({ id: row.id_genero, name: row.nombre })),
      marital_statuses: (maritalStatuses.data ?? []).map((row) => ({
        id: row.id_estado_civil,
        name: row.nombre,
      })),
      credit_types: (creditTypes.data ?? []).map((row) => ({ id: row.id_tipo_credito, name: row.nombre })),
    };

    return NextResponse.json(catalogs);
  } catch (error) {
    console.error("Error inesperado al consultar catálogos:", error);
    reportServerIncident("api · catálogos", error);
    return NextResponse.json({ error: "No se pudieron cargar los catálogos." }, { status: 500 });
  }
}

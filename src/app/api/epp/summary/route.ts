import { NextResponse, type NextRequest } from "next/server";
import type { EppMonthSummary } from "@/lib/permissions";
import { reportServerIncident } from "@/lib/incidents";
import { getAuthenticatedClient } from "../../employees/_server";
import { eppDatabaseError, resolveSite } from "../_shared";

// Totales por mes de la sede (vista epp_month_summary, calculada en la base): tarjetas del encabezado
// y lista de meses del control mensual. Son unas cuantas filas, en lugar de todo el libro de movimientos.
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  const resolved = resolveSite(auth.access, request.nextUrl.searchParams.get("site"));
  if ("response" in resolved) return resolved.response;
  try {
    const { data, error } = await auth.client
      .from("epp_month_summary")
      .select("month,delivered,received,workers,movements")
      .eq("site", resolved.site)
      .order("month", { ascending: false })
      .limit(240);
    if (error) return eppDatabaseError(error, "resumen mensual");
    return NextResponse.json((data ?? []) as EppMonthSummary[]);
  } catch (error) {
    reportServerIncident("api · epp · resumen", error);
    return NextResponse.json({ error: "No se pudo cargar el resumen." }, { status: 500 });
  }
}

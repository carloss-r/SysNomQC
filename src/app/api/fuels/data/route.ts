import { NextResponse, type NextRequest } from "next/server";
import type { FuelCoke, FuelProduct, FuelReception, FuelSchedule, FuelSupplier } from "@/lib/fuels";
import { plantToday } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { getAuthenticatedClient } from "../../employees/_server";
import { fuelDatabaseError, readAll } from "../_shared";

const NUMERIC = {
  product: ["calorific_value", "chlorine_pct", "water_pct", "sulfur_pct", "rate_per_ton"],
  schedule: ["estimated_tons"],
  reception: ["calorific_value", "gross_kg", "tare_kg", "net_kg", "chlorine_pct", "rate_per_ton", "subtotal", "month_pct_after"],
  coke: ["coke_tons"],
} as const;

/** PostgREST puede devolver numeric como texto: se normaliza a número. */
function numbers<T>(row: T, keys: readonly string[]): T {
  const copy = { ...row } as Record<string, unknown>;
  for (const key of keys) if (copy[key] !== null && copy[key] !== undefined) copy[key] = Number(copy[key]);
  return copy as T;
}

/**
 * Todo lo que necesita la pantalla en una sola petición: proveedores con sus productos, agenda,
 * tickets de báscula y consumo de coque. ?from=YYYY-MM-DD acota agenda y tickets (por omisión, desde
 * el 1 de enero del año anterior, suficiente para el reporte semestral y el comparativo anual).
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "fuels.view");
  if ("response" in auth) return auth.response;
  const { client } = auth;
  const today = plantToday();
  const requested = request.nextUrl.searchParams.get("from");
  const from = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : `${Number(today.slice(0, 4)) - 1}-01-01`;

  try {
    const [suppliers, products, schedule, receptions, coke] = await Promise.all([
      readAll<Omit<FuelSupplier, "products">>((a, b) => client.from("fuel_suppliers").select("*").order("business_name").range(a, b)),
      readAll<FuelProduct>((a, b) => client.from("fuel_products").select("*").order("name").range(a, b)),
      readAll<FuelSchedule>((a, b) =>
        client.from("fuel_schedule").select("*").gte("scheduled_on", from).order("scheduled_on", { ascending: false }).order("id", { ascending: false }).range(a, b),
      ),
      // Los que siguen en planta se incluyen siempre, aunque hayan entrado antes de "from".
      readAll<FuelReception>((a, b) =>
        client
          .from("fuel_receptions")
          .select("*")
          .or(`received_on.gte.${from},status.eq.en_planta,and(status.eq.cancelado,created_at.gte.${from})`)
          .order("id", { ascending: false })
          .range(a, b),
      ),
      readAll<FuelCoke>((a, b) => client.from("fuel_coke_consumption").select("*").order("month", { ascending: false }).range(a, b)),
    ]);
    for (const [name, result] of Object.entries({ suppliers, products, schedule, receptions, coke })) {
      if (result.error) return fuelDatabaseError(result.error, `leer ${name}`);
    }

    const byProduct = new Map<number, FuelProduct[]>();
    for (const row of products.rows) {
      const list = byProduct.get(row.supplier_id) ?? [];
      list.push(numbers(row, NUMERIC.product));
      byProduct.set(row.supplier_id, list);
    }
    // Sin campos de auditoría interna (quién modificó por id) hacia el navegador.
    const strip = <T extends Record<string, unknown>>(row: T) => {
      const { updated_by: _a, created_by: _b, closed_by: _c, ...rest } = row as Record<string, unknown>;
      void _a; void _b; void _c;
      return rest as T;
    };

    return NextResponse.json({
      today,
      from,
      suppliers: suppliers.rows.map((row) => ({ ...strip(row), products: byProduct.get(row.id) ?? [] })),
      schedule: schedule.rows.map((row) => strip(numbers(row, NUMERIC.schedule))),
      receptions: receptions.rows.map((row) => strip(numbers(row, NUMERIC.reception))),
      coke: coke.rows.map((row) => strip(numbers(row, NUMERIC.coke))),
    });
  } catch (error) {
    reportServerIncident("api · combustibles · leer", error);
    return NextResponse.json({ error: "No se pudo cargar el módulo de combustibles alternos." }, { status: 500 });
  }
}

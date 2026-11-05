import { NextResponse, type NextRequest } from "next/server";
import { reportServerIncident } from "@/lib/incidents";
import { getAuthenticatedClient } from "../../employees/_server";

// Niveles: out = agotado, low = en o bajo el mínimo (reponer ya), soon = cerca del mínimo (anticipar compra).
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "epp.view");
  if ("response" in auth) return auth.response;
  try {
    const { data, error } = await auth.client
      .from("epp_articles")
      .select("id,name,stock,min_stock,unit")
      .eq("active", true)
      .limit(1000);
    if (error) throw error;
    const alerts = (data ?? [])
      .map((item) => {
        const level = item.stock === 0 ? "out" : item.stock <= item.min_stock ? "low" : item.stock <= Math.ceil(item.min_stock * 1.5) ? "soon" : null;
        return level ? { ...item, level } : null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => ({ out: 0, low: 1, soon: 2 })[a.level] - ({ out: 0, low: 1, soon: 2 })[b.level] || a.stock - b.stock);
    return NextResponse.json(alerts);
  } catch (error) {
    reportServerIncident("api · epp · alertas", error);
    return NextResponse.json({ error: "No se pudieron cargar las alertas." }, { status: 500 });
  }
}

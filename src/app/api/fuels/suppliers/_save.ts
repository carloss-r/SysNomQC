import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { qualityProblems } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { fuelDatabaseError, supplierSchema } from "../_shared";

/** Alta (id null) o edición de un proveedor con sus productos; la base valida el análisis otra vez. */
export async function saveSupplier(request: NextRequest, id: number | null) {
  const auth = await getAuthenticatedClient(request, "fuels.suppliers");
  if ("response" in auth) return auth.response;
  try {
    const input = supplierSchema.safeParse(await readJson(request));
    if (!input.success) {
      const rfc = input.error.issues.some((issue) => issue.path[0] === "rfc");
      return NextResponse.json({ error: rfc ? "El RFC no es válido." : "Revisa los datos del proveedor." }, { status: 400 });
    }
    const { products, ...supplier } = input.data;
    const problems = products.flatMap((product) => qualityProblems(product));
    if (problems.length > 0) {
      return NextResponse.json({ error: `No pasa el análisis: ${problems.join(" ")}` }, { status: 409 });
    }

    const { data, error } = await auth.client.rpc("fuel_save_supplier", {
      p_id: id,
      p_supplier: supplier,
      p_products: products.map((product) => ({ ...product, id: product.id ?? null })),
    });
    if (error) return fuelDatabaseError(error, id ? "editar proveedor" : "crear proveedor");
    await recordAudit(request, auth.access, id ? "fuels.supplier.update" : "fuels.supplier.create", data as number, {
      products: products.length,
      status: supplier.status,
    });
    return NextResponse.json({ id: data }, { status: id ? 200 : 201 });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · combustibles · guardar proveedor", error);
    return NextResponse.json({ error: "No se pudo guardar el proveedor." }, { status: 500 });
  }
}

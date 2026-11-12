import { NextResponse, type NextRequest } from "next/server";
import { parseId } from "../../_shared";
import { saveSupplier } from "../_save";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "El proveedor no es válido." }, { status: 400 });
  return saveSupplier(request, id);
}

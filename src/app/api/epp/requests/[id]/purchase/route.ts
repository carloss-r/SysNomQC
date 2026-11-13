import type { NextRequest } from "next/server";
import { purchaseBuySchema } from "../../../_shared";
import { runRequestAction } from "../../_action";

// Compras registra la cantidad que compró de cada artículo; la solicitud pasa a "en compra".
export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return runRequestAction(request, context, {
    permission: "epp.purchase",
    rpc: "epp_register_purchase",
    audit: "epp.purchase.buy",
    label: "registrar compra",
    schema: purchaseBuySchema,
  });
}

import type { NextRequest } from "next/server";
import { purchaseCountSchema } from "../../../_shared";
import { runRequestAction } from "../../_action";

// Seguridad cuenta lo que llegó sin conocer lo comprado; el conteo suma la existencia y libera el artículo.
export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return runRequestAction(request, context, {
    permission: "epp.manage",
    rpc: "epp_count_purchase",
    audit: "epp.purchase.count",
    label: "conteo de compra",
    schema: purchaseCountSchema,
  });
}

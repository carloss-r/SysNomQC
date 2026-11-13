import type { NextRequest } from "next/server";
import { runRequestAction } from "../../_action";

// Compras marca como enterado el aviso de que llegó menos de lo comprado.
export function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return runRequestAction(request, context, {
    permission: "epp.purchase",
    rpc: "epp_ack_shortage",
    audit: "epp.purchase.shortage_ack",
    label: "aviso de faltante",
  });
}

import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { reportServerIncident } from "@/lib/incidents";
import type { Permission } from "@/lib/permissions";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { eppDatabaseError } from "../_shared";

type Items = { items: { article_id: number; quantity: number }[]; note?: string };

/**
 * Acción sobre una solicitud (registrar compra, contar lo que llegó, enterarse del faltante).
 * La API revisa el permiso; la función SQL vuelve a validar permiso, sede y estado.
 */
export async function runRequestAction(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
  options: { permission: Permission; rpc: string; audit: string; label: string; schema?: z.ZodType<Items> },
) {
  const auth = await getAuthenticatedClient(request, options.permission);
  if ("response" in auth) return auth.response;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 400 });
  try {
    let args: Record<string, unknown> = { p_id: id };
    let items = 0;
    if (options.schema) {
      const input = options.schema.safeParse(await readJson(request));
      if (!input.success) return NextResponse.json({ error: "Revisa los artículos y cantidades." }, { status: 400 });
      args = { ...args, p_items: input.data.items, p_note: input.data.note ?? null };
      items = input.data.items.length;
    }
    const { data, error } = await auth.client.rpc(options.rpc, args);
    if (error) return eppDatabaseError(error, options.label);
    // Solo el número de renglones: las cantidades no van a la bitácora (el conteo es ciego).
    await recordAudit(request, auth.access, options.audit, id, items ? { items } : undefined);
    return NextResponse.json(data ?? { id });
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident(`api · epp · ${options.label}`, error);
    return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
  }
}

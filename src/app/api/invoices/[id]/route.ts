import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { plantToday } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import { actorName, EDITABLE_FIELDS, INVOICE_BUCKET, invoiceDatabaseError, LIST_COLUMNS, parseId, patchSchema, toInvoice } from "../_shared";

type Context = { params: Promise<{ id: string }> };

/** Una factura con su texto digitalizado. */
export async function GET(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "invoices.view");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Factura no válida." }, { status: 400 });
  const { data, error } = await auth.client.from("invoices").select(`${LIST_COLUMNS},text_content`).eq("id", id).maybeSingle();
  if (error) return invoiceDatabaseError(error, "leer una");
  if (!data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
  // Bitácora de correcciones (si aún no existe la tabla, la factura se muestra sin historial).
  const edits = await auth.client
    .from("invoice_edits")
    .select("id,edited_at,edited_by_name,changes")
    .eq("invoice_id", id)
    .order("edited_at", { ascending: false })
    .limit(200);
  if (edits.error && !["42P01", "PGRST205"].includes(edits.error.code ?? "")) return invoiceDatabaseError(edits.error, "leer correcciones");
  return NextResponse.json({ ...toInvoice(data as unknown as Record<string, unknown>), edits: edits.data ?? [] });
}

/** Corrige los datos de la factura o cambia su estatus de pago. */
export async function PATCH(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "invoices.manage");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Factura no válida." }, { status: 400 });
  try {
    const input = patchSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los datos de la factura." }, { status: 400 });
    const actor = actorName(auth.access);
    const today = plantToday();

    let changes: Record<string, unknown>;
    let diff: Record<string, { from: unknown; to: unknown }> | null = null;
    if (input.data.action === "status") {
      const paid = input.data.status === "pagada";
      const incident = input.data.status === "incidente";
      const paidOn = input.data.paid_on ?? today;
      if (paid && paidOn > today) return NextResponse.json({ error: "La fecha de pago no puede ser futura." }, { status: 400 });
      if (incident && !input.data.incident_description) {
        return NextResponse.json({ error: "Describe el incidente de la factura." }, { status: 400 });
      }
      changes = {
        status: input.data.status,
        paid_on: paid ? paidOn : null,
        paid_by_name: paid ? actor : null,
        // Al salir de incidente se limpia; la descripción queda en la bitácora de auditoría.
        incident_description: incident ? input.data.incident_description : null,
        incident_on: incident ? today : null,
        incident_by_name: incident ? actor : null,
      };
    } else {
      const { action: _action, ...fields } = input.data;
      void _action;
      if (fields.due_date && fields.due_date < fields.invoice_date) {
        return NextResponse.json({ error: "El vencimiento no puede ser anterior a la fecha de la factura." }, { status: 400 });
      }
      changes = fields;
      const current = await auth.client.from("invoices").select(EDITABLE_FIELDS.join(",")).eq("id", id).maybeSingle();
      if (current.error) return invoiceDatabaseError(current.error, "leer antes de editar");
      if (!current.data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
      const before = toInvoice(current.data as unknown as Record<string, unknown>) as unknown as Record<string, unknown>;
      diff = {};
      for (const key of EDITABLE_FIELDS) {
        const from = before[key] ?? null;
        const to = (fields as Record<string, unknown>)[key] ?? null;
        if (from !== to) diff[key] = { from, to };
      }
      if (Object.keys(diff).length === 0) return NextResponse.json({ error: "No hay cambios que guardar." }, { status: 400 });
    }

    const { data, error } = await auth.client
      .from("invoices")
      .update({ ...changes, updated_at: new Date().toISOString(), updated_by_name: actor })
      .eq("id", id)
      .select(LIST_COLUMNS)
      .maybeSingle();
    if (error) return invoiceDatabaseError(error, "actualizar");
    if (!data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
    if (diff) {
      // Quién corrigió qué dato y cuál era el valor anterior.
      const logged = await auth.client.from("invoice_edits").insert({ invoice_id: id, edited_by: auth.access.user_id, edited_by_name: actor, changes: diff });
      if (logged.error) {
        console.error("No se pudo guardar la corrección de la factura:", logged.error);
        reportServerIncident("api · facturas · bitácora de correcciones", logged.error);
      }
    }
    await recordAudit(request, auth.access, input.data.action === "status" ? "invoices.status" : "invoices.update", id, {
      ...(input.data.action === "status"
        ? { status: input.data.status, ...(input.data.incident_description ? { incident: input.data.incident_description } : {}) }
        : { fields: Object.keys(diff ?? {}) }),
    });
    return NextResponse.json(toInvoice(data as unknown as Record<string, unknown>));
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · facturas · actualizar", error);
    return NextResponse.json({ error: "No se pudo actualizar la factura." }, { status: 500 });
  }
}

/** Elimina la factura y su PDF. */
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "invoices.manage");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Factura no válida." }, { status: 400 });
  try {
    const { data, error } = await auth.client.from("invoices").delete().eq("id", id).select("id,file_path,folio").maybeSingle();
    if (error) return invoiceDatabaseError(error, "eliminar");
    if (!data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
    const removed = await auth.client.storage.from(INVOICE_BUCKET).remove([data.file_path as string]);
    if (removed.error) console.error("No se pudo eliminar el PDF de la factura:", removed.error);
    await recordAudit(request, auth.access, "invoices.delete", id, { folio: data.folio });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    reportServerIncident("api · facturas · eliminar", error);
    return NextResponse.json({ error: "No se pudo eliminar la factura." }, { status: 500 });
  }
}

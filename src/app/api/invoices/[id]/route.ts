import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { plantToday } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { canDeleteInvoice, complementMatches, invoiceStep, nextInvoiceStage, type Invoice } from "@/lib/invoices";
import { BadJsonError, getAuthenticatedClient, readJson } from "../../employees/_server";
import {
  actorName,
  INVOICE_BUCKET,
  invoiceDatabaseError,
  LIST_COLUMNS,
  parseId,
  patchSchema,
  readUploadedPdf,
  removeFile,
  toInvoice,
} from "../_shared";

type Context = { params: Promise<{ id: string }> };

/** Una factura con su texto digitalizado y su historial (cada paso, quién y cuándo). */
export async function GET(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "invoices.view");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Factura no válida." }, { status: 400 });
  const [invoice, events] = await Promise.all([
    auth.client.from("invoices").select(`${LIST_COLUMNS},text_content`).eq("id", id).maybeSingle(),
    auth.client.from("invoice_events").select("id,event,detail,at,by_name").eq("invoice_id", id).order("at").order("id").limit(100),
  ]);
  if (invoice.error) return invoiceDatabaseError(invoice.error, "leer una");
  if (!invoice.data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
  if (events.error) return invoiceDatabaseError(events.error, "leer historial");
  return NextResponse.json({ ...toInvoice(invoice.data as unknown as Record<string, unknown>), events: events.data ?? [] });
}

const STEP_LABEL = { firmar: "firmarla", cargar: "cargarla al sistema", contrarecibo: "cargar su contrarecibo", complemento: "cargar su complemento de pago" };

/**
 * Avanza la factura un paso: firmada → cargada al sistema → contrarecibo → complemento de pago (cerrada).
 * Los datos de la factura no se modifican; la base rechaza cualquier otro cambio.
 */
export async function PATCH(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "invoices.manage");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Factura no válida." }, { status: 400 });
  let uploaded: string | null = null;
  try {
    const input = patchSchema.safeParse(await readJson(request));
    if (!input.success) return NextResponse.json({ error: "Revisa los datos del paso." }, { status: 400 });
    if (input.data.action !== "stage") uploaded = input.data.file_path;

    const current = await auth.client.from("invoices").select("stage,status,uuid,invoice_date,receipt_path,complement_path").eq("id", id).maybeSingle();
    if (current.error) return invoiceDatabaseError(current.error, "leer antes del paso");
    if (!current.data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
    const invoice = current.data as Pick<Invoice, "stage" | "status" | "uuid" | "invoice_date" | "receipt_path" | "complement_path">;

    // Cada paso solo cuando le toca (la base lo vuelve a revisar).
    const step = invoiceStep(invoice);
    const wanted = input.data.action === "stage" ? (input.data.stage === "firmada" ? "firmar" : "cargar") : input.data.action === "receipt" ? "contrarecibo" : "complemento";
    if (step !== wanted) {
      if (uploaded) await removeFile(auth.client, uploaded);
      const message = step === "cerrada" ? "La factura ya está cerrada (tiene su complemento de pago)." : `A esta factura le toca ${STEP_LABEL[step]}.`;
      return NextResponse.json({ error: message }, { status: 409 });
    }

    const actor = actorName(auth.access);
    const now = new Date().toISOString();
    let changes: Record<string, unknown>;
    let audit: Record<string, unknown>;

    if (input.data.action === "stage") {
      if (nextInvoiceStage(invoice.stage) !== input.data.stage) return NextResponse.json({ error: "El estado solo avanza de uno en uno." }, { status: 409 });
      changes = input.data.stage === "firmada" ? { stage: "firmada", signed_at: now, signed_by_name: actor } : { stage: "cargada", loaded_at: now, loaded_by_name: actor };
      audit = { stage: input.data.stage };
    } else {
      if (input.data.action === "receipt") {
        const { payment_date } = input.data;
        const today = plantToday();
        const nextYear = `${Number(today.slice(0, 4)) + 1}${today.slice(4)}`;
        if (payment_date < invoice.invoice_date || payment_date > nextYear) {
          await removeFile(auth.client, input.data.file_path);
          return NextResponse.json({ error: "La fecha de cobro debe ser posterior a la fecha de la factura y dentro del próximo año." }, { status: 400 });
        }
      }
      const pdf = await readUploadedPdf(auth.client, input.data.file_path);
      if ("response" in pdf) {
        uploaded = null;
        return pdf.response;
      }
      if (input.data.action === "receipt") {
        changes = {
          receipt_path: input.data.file_path,
          receipt_name: input.data.file_name,
          receipt_text: pdf.text,
          payment_date: input.data.payment_date,
          receipt_at: now,
          receipt_by_name: actor,
        };
        audit = { receipt: input.data.file_name, payment_date: input.data.payment_date };
      } else {
        // Verificación: el complemento de pago debe mencionar el UUID (folio fiscal) de la factura.
        const verified = complementMatches(invoice.uuid, pdf.plain);
        changes = {
          complement_path: input.data.file_path,
          complement_name: input.data.file_name,
          complement_text: pdf.text,
          complement_at: now,
          complement_by_name: actor,
          complement_verified: verified,
        };
        audit = { complement: input.data.file_name, verified };
      }
    }

    const { data, error } = await auth.client
      .from("invoices")
      .update({ ...changes, updated_at: now, updated_by_name: actor })
      .eq("id", id)
      .select(LIST_COLUMNS)
      .maybeSingle();
    if (error || !data) {
      if (uploaded) await removeFile(auth.client, uploaded);
      return error ? invoiceDatabaseError(error, "avanzar") : NextResponse.json({ error: "La factura no existe." }, { status: 404 });
    }
    uploaded = null;
    await recordAudit(request, auth.access, `invoices.${input.data.action}`, id, audit);
    return NextResponse.json(toInvoice(data as unknown as Record<string, unknown>));
  } catch (error) {
    if (uploaded) await removeFile(auth.client, uploaded);
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    reportServerIncident("api · facturas · avanzar", error);
    return NextResponse.json({ error: "No se pudo registrar el paso de la factura." }, { status: 500 });
  }
}

/** Elimina la factura y sus PDF: solo mientras está enviada (o el Super administrador). El historial se conserva. */
export async function DELETE(request: NextRequest, context: Context) {
  const auth = await getAuthenticatedClient(request, "invoices.manage");
  if ("response" in auth) return auth.response;
  const id = parseId((await context.params).id);
  if (!id) return NextResponse.json({ error: "Factura no válida." }, { status: 400 });
  try {
    const current = await auth.client.from("invoices").select("stage,status").eq("id", id).maybeSingle();
    if (current.error) return invoiceDatabaseError(current.error, "leer antes de eliminar");
    if (!current.data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
    if (!canDeleteInvoice(current.data as Pick<Invoice, "stage" | "status">, auth.access.is_super_admin)) {
      return NextResponse.json({ error: "Solo se puede eliminar una factura enviada (antes de firmarla). Después, solo el Super administrador." }, { status: 409 });
    }
    const { data, error } = await auth.client
      .from("invoices")
      .delete()
      .eq("id", id)
      .select("id,folio,stage,file_path,receipt_path,complement_path")
      .maybeSingle();
    if (error) return invoiceDatabaseError(error, "eliminar");
    if (!data) return NextResponse.json({ error: "La factura no existe." }, { status: 404 });
    const paths = [data.file_path, data.receipt_path, data.complement_path].filter((path): path is string => typeof path === "string");
    const removed = await auth.client.storage.from(INVOICE_BUCKET).remove(paths);
    if (removed.error) console.error("No se pudieron eliminar los PDF de la factura:", removed.error);
    await recordAudit(request, auth.access, "invoices.delete", id, { folio: data.folio, stage: data.stage });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    reportServerIncident("api · facturas · eliminar", error);
    return NextResponse.json({ error: "No se pudo eliminar la factura." }, { status: 500 });
  }
}

import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { plantToday } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { parseInvoiceText } from "@/lib/invoices";
import { BadJsonError, getAuthenticatedClient, readJson } from "../employees/_server";
import { readAll } from "../fuels/_shared";
import { InvalidPdfError, pdfToText } from "./_extract";
import {
  actorName,
  INVOICE_BUCKET,
  invoiceDatabaseError,
  LIST_COLUMNS,
  MAX_INVOICE_BYTES,
  toInvoice,
  uploadSchema,
} from "./_shared";

export const runtime = "nodejs";

/** Lista de facturas (sin el texto completo). ?from=YYYY-MM-DD acota por fecha de factura. */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "invoices.view");
  if ("response" in auth) return auth.response;
  const today = plantToday();
  const requested = request.nextUrl.searchParams.get("from");
  const from = requested && /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : `${Number(today.slice(0, 4)) - 1}-01-01`;
  try {
    const result = await readAll<Record<string, unknown>>((a, b) =>
      auth.client
        .from("invoices")
        .select(LIST_COLUMNS)
        // Las pendientes se incluyen siempre, aunque sean anteriores a "from".
        .or(`invoice_date.gte.${from},status.eq.pendiente`)
        .order("invoice_date", { ascending: false })
        .order("id", { ascending: false })
        .range(a, b),
    );
    if (result.error) return invoiceDatabaseError(result.error, "leer");
    return NextResponse.json({ today, from, invoices: result.rows.map(toInvoice) });
  } catch (error) {
    reportServerIncident("api · facturas · leer", error);
    return NextResponse.json({ error: "No se pudieron cargar las facturas." }, { status: 500 });
  }
}

/**
 * Registra una factura cuyo PDF ya subió el navegador al bucket privado: lo digitaliza (texto),
 * detecta fecha, folio, emisor y montos, y la guarda como pendiente de pago.
 */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedClient(request, "invoices.manage");
  if ("response" in auth) return auth.response;
  const { client, access } = auth;
  let input;
  try {
    input = uploadSchema.safeParse(await readJson(request));
  } catch (error) {
    if (error instanceof BadJsonError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  if (!input.success) return NextResponse.json({ error: "Archivo no válido." }, { status: 400 });
  const { file_path, file_name } = input.data;
  const discard = () => client.storage.from(INVOICE_BUCKET).remove([file_path]).then(() => undefined, () => undefined);

  try {
    const download = await client.storage.from(INVOICE_BUCKET).download(file_path);
    if (download.error || !download.data) {
      return NextResponse.json({ error: "No se encontró el PDF subido. Vuelve a intentarlo." }, { status: 404 });
    }
    if (download.data.size > MAX_INVOICE_BYTES) {
      await discard();
      return NextResponse.json({ error: "El PDF pesa más de 10 MB." }, { status: 400 });
    }
    const bytes = new Uint8Array(await download.data.arrayBuffer());

    let extracted: { text: string; plain: string; pages: number };
    try {
      extracted = await pdfToText(bytes);
    } catch (error) {
      if (error instanceof InvalidPdfError) {
        await discard();
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const fields = parseInvoiceText(extracted.plain);
    const today = plantToday();
    const actor = actorName(access);
    const { data, error } = await client
      .from("invoices")
      .insert({
        file_path,
        file_name,
        file_size: bytes.length,
        invoice_date: fields.invoice_date ?? today,
        due_date: fields.due_date,
        folio: fields.folio,
        uuid: fields.uuid,
        supplier_name: fields.supplier_name,
        supplier_rfc: fields.supplier_rfc,
        subtotal: fields.subtotal,
        tax: fields.tax,
        total: fields.total,
        currency: fields.currency,
        status: "pendiente",
        text_content: extracted.text,
        text_pages: extracted.pages,
        created_by_name: actor,
        updated_by_name: actor,
      })
      .select(LIST_COLUMNS)
      .single();
    if (error) {
      await discard();
      return invoiceDatabaseError(error, "registrar");
    }
    const invoice = toInvoice(data as unknown as Record<string, unknown>);
    await recordAudit(request, access, "invoices.create", invoice.id, { pages: extracted.pages, has_text: invoice.has_text });
    return NextResponse.json(
      {
        invoice,
        // Qué datos se detectaron en el PDF (para pedir al usuario que revise los demás).
        detected: {
          invoice_date: fields.invoice_date !== null,
          total: fields.total !== null,
          supplier: fields.supplier_name !== null || fields.supplier_rfc !== null,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    await discard();
    reportServerIncident("api · facturas · registrar", error);
    return NextResponse.json({ error: "No se pudo registrar la factura." }, { status: 500 });
  }
}

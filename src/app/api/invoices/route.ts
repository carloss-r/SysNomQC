import { NextResponse, type NextRequest } from "next/server";
import { recordAudit } from "@/lib/audit";
import { plantToday } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";
import { parseInvoiceText } from "@/lib/invoices";
import { BadJsonError, getAuthenticatedClient, readJson } from "../employees/_server";
import { readAll } from "../fuels/_shared";
import { actorName, invoiceDatabaseError, LIST_COLUMNS, readUploadedPdf, removeFile, toInvoice, uploadSchema } from "./_shared";

export const runtime = "nodejs";

/** Lista de facturas (sin los textos). ?from=YYYY-MM-DD acota por fecha de carga; las que no están cobradas van siempre. */
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
        // Las que siguen en proceso (sin complemento de pago) se incluyen siempre, aunque sean anteriores a "from".
        .or(`created_at.gte.${from},complement_path.is.null`)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(a, b)
        // Con tantas columnas el analizador de tipos de supabase-js se rinde: se declara la fila.
        .overrideTypes<Record<string, unknown>[], { merge: false }>(),
    );
    if (result.error) return invoiceDatabaseError(result.error, "leer");
    return NextResponse.json({ today, from, invoices: result.rows.map(toInvoice) });
  } catch (error) {
    reportServerIncident("api · facturas · leer", error);
    return NextResponse.json({ error: "No se pudieron cargar las facturas." }, { status: 500 });
  }
}

/**
 * Registra una factura cuyo PDF ya subió el navegador al bucket privado: lo digitaliza (texto), detecta fecha,
 * folio del PDF, UUID y montos, y la guarda como enviada. La base le pone el folio del sistema (FAC-00001) y la
 * moneda nacional. Lo detectado ya no se modifica.
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

  try {
    const pdf = await readUploadedPdf(client, file_path);
    if ("response" in pdf) return pdf.response;

    const fields = parseInvoiceText(pdf.plain);
    const actor = actorName(access);
    const { data, error } = await client
      .from("invoices")
      .insert({
        file_path,
        file_name,
        file_size: pdf.bytes,
        invoice_date: fields.invoice_date ?? plantToday(),
        due_date: fields.due_date,
        pdf_folio: fields.folio,
        uuid: fields.uuid,
        subtotal: fields.subtotal,
        tax: fields.tax,
        total: fields.total,
        currency: "MXN",
        status: "pendiente",
        stage: "enviada",
        text_content: pdf.text,
        text_pages: pdf.pages,
        created_by_name: actor,
        updated_by_name: actor,
      })
      .select(LIST_COLUMNS)
      .single();
    if (error) {
      await removeFile(client, file_path);
      return invoiceDatabaseError(error, "registrar");
    }
    const invoice = toInvoice(data as unknown as Record<string, unknown>);
    await recordAudit(request, access, "invoices.create", invoice.id, { folio: invoice.folio, pages: pdf.pages, has_text: invoice.has_text });
    return NextResponse.json(
      {
        invoice,
        // Qué datos se encontraron en el PDF (lo que falte queda vacío: ya no se captura a mano).
        detected: { invoice_date: fields.invoice_date !== null, total: fields.total !== null, uuid: fields.uuid !== null },
      },
      { status: 201 },
    );
  } catch (error) {
    await removeFile(client, file_path);
    reportServerIncident("api · facturas · registrar", error);
    return NextResponse.json({ error: "No se pudo registrar la factura." }, { status: 500 });
  }
}

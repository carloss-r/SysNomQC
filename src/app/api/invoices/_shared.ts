import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { reportServerIncident } from "@/lib/incidents";
import { type Invoice } from "@/lib/invoices";
import { InvalidPdfError, pdfToText } from "./_extract";

export const INVOICE_BUCKET = "invoices";
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/** Columnas de la lista (sin los textos completos, que solo se piden al abrir una factura). */
export const LIST_COLUMNS =
  "id,folio,pdf_folio,file_path,file_name,file_size,invoice_date,due_date,uuid,subtotal,tax,total,currency,status,incident_description,stage,signed_at,signed_by_name,loaded_at,loaded_by_name,receipt_path,receipt_name,payment_date,receipt_at,receipt_by_name,complement_path,complement_name,complement_at,complement_by_name,complement_verified,text_pages,has_text,created_at,created_by_name,updated_at,updated_by_name";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.");
// PDF ya subido por el navegador al bucket privado: factura (uuid.pdf), contrarecibo (cr-uuid.pdf) o complemento (cp-uuid.pdf).
const filePath = (prefix: string) => z.string().regex(new RegExp(`^${prefix}[\\w-]+\\.pdf$`));
const fileName = z.string().trim().min(1).max(200);

export const uploadSchema = z.object({ file_path: filePath(""), file_name: fileName }).strict();

/** Pasos del flujo. Ningún dato de la factura se modifica: solo se avanza. */
export const patchSchema = z.discriminatedUnion("action", [
  // Los cuadritos 2 y 3: firmada / autorizada y cargada al sistema.
  z.object({ action: z.literal("stage"), stage: z.enum(["firmada", "cargada"]) }).strict(),
  // Contrarecibo con la fecha posible de cobro (ya cargada al sistema); después falta el complemento.
  z.object({ action: z.literal("receipt"), file_path: filePath("cr-"), file_name: fileName, payment_date: day }).strict(),
  // Complemento de pago: la factura queda cerrada.
  z.object({ action: z.literal("complement"), file_path: filePath("cp-"), file_name: fileName }).strict(),
]);

export const parseId = (raw: string) => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** PostgREST puede devolver numeric como texto: se normaliza a número. */
export function toInvoice(row: Record<string, unknown>): Invoice {
  const copy = { ...row };
  for (const key of ["subtotal", "tax", "total"]) if (copy[key] !== null && copy[key] !== undefined) copy[key] = Number(copy[key]);
  return copy as unknown as Invoice;
}

export function actorName(access: { full_name: string | null; email: string }) {
  return access.full_name || access.email || "Usuario";
}

export const removeFile = (client: SupabaseClient, path: string) =>
  client.storage.from(INVOICE_BUCKET).remove([path]).then(() => undefined, () => undefined);

/**
 * Descarga del bucket un PDF que acaba de subir el navegador y saca su texto.
 * Si no es válido lo borra y devuelve la respuesta de error.
 */
export async function readUploadedPdf(
  client: SupabaseClient,
  path: string,
): Promise<{ bytes: number; text: string; plain: string; pages: number } | { response: NextResponse }> {
  const download = await client.storage.from(INVOICE_BUCKET).download(path);
  if (download.error || !download.data) {
    return { response: NextResponse.json({ error: "No se encontró el PDF subido. Vuelve a intentarlo." }, { status: 404 }) };
  }
  if (download.data.size > MAX_INVOICE_BYTES) {
    await removeFile(client, path);
    return { response: NextResponse.json({ error: "El PDF pesa más de 10 MB." }, { status: 400 }) };
  }
  const bytes = new Uint8Array(await download.data.arrayBuffer());
  try {
    return { bytes: bytes.length, ...(await pdfToText(bytes)) };
  } catch (error) {
    if (error instanceof InvalidPdfError) {
      await removeFile(client, path);
      return { response: NextResponse.json({ error: error.message }, { status: 400 }) };
    }
    throw error;
  }
}

export function invoiceDatabaseError(error: { code?: string; message: string }, context: string) {
  if (error.code === "23505") return NextResponse.json({ error: "Ese archivo ya está registrado." }, { status: 409 });
  if (error.code === "23514") {
    // Reglas de la base: el estado solo avanza; contrarecibo solo ya cargada al sistema; complemento solo con contrarecibo.
    const message = error.message.includes("solo avanza") ? error.message : "Ese paso no corresponde al estado actual de la factura.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  // Candado de la base: los datos no se modifican, cada paso se marca una sola vez, con complemento = cerrada.
  if (error.code === "42501" && /factura|paso/i.test(error.message)) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error.code === "42501") return NextResponse.json({ error: "Tu rol no tiene permiso para realizar esta acción." }, { status: 403 });
  if (["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code ?? "")) {
    return NextResponse.json(
      { error: "Faltan migraciones de facturas en Supabase (hasta 202611250002_facturas_cierre_y_roles.sql)." },
      { status: 503 },
    );
  }
  // .single() sin fila: la factura no se pudo leer después de guardarla (normalmente, permisos de lectura).
  if (error.code === "PGRST116") return NextResponse.json({ error: "La factura no existe o tu rol no puede verla." }, { status: 404 });
  console.error(`Error de facturas (${context}):`, error);
  reportServerIncident(`api · facturas · ${context}`, error);
  // Solo el código (para diagnosticar); el detalle interno de la base va al correo de incidencias, no a la pantalla.
  return NextResponse.json({ error: `No se pudo completar la operación (${context}${error.code ? ` · código ${error.code}` : ""}).` }, { status: 500 });
}

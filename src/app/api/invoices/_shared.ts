import { NextResponse } from "next/server";
import { z } from "zod";
import { reportServerIncident } from "@/lib/incidents";
import type { Invoice } from "@/lib/invoices";

export const INVOICE_BUCKET = "invoices";
export const MAX_INVOICE_BYTES = 10 * 1024 * 1024;

/** Columnas de la lista (sin el texto completo, que solo se pide al abrir una factura). */
export const LIST_COLUMNS =
  "id,file_path,file_name,file_size,invoice_date,due_date,folio,uuid,supplier_name,supplier_rfc,subtotal,tax,total,currency,notes,status,paid_on,paid_by_name,text_pages,has_text,created_at,created_by_name,updated_at,updated_by_name";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const amount = z.number().min(0).max(1_000_000_000).nullable().optional().transform((value) => value ?? null);

export const uploadSchema = z.object({
  // Ruta dentro del bucket privado (la sube el navegador antes de registrar la factura).
  file_path: z.string().regex(/^[\w-]+\.pdf$/),
  file_name: z.string().trim().min(1).max(200),
});

export const editSchema = z.object({
  action: z.literal("edit"),
  invoice_date: day,
  due_date: day.nullable().optional().transform((value) => value ?? null),
  folio: optionalText(60),
  uuid: optionalText(36),
  supplier_name: optionalText(160),
  supplier_rfc: z.string().trim().toUpperCase().max(13).nullable().optional().transform((value) => value || null),
  subtotal: amount,
  tax: amount,
  total: amount,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Moneda no válida."),
  notes: optionalText(500),
});

export const statusSchema = z.object({
  action: z.literal("status"),
  status: z.enum(["pendiente", "pagada"]),
  paid_on: day.nullable().optional(),
});

export const patchSchema = z.discriminatedUnion("action", [editSchema, statusSchema]);

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

export function invoiceDatabaseError(error: { code?: string; message: string }, context: string) {
  if (error.code === "23505") return NextResponse.json({ error: "Ese archivo ya está registrado." }, { status: 409 });
  if (error.code === "23514") return NextResponse.json({ error: "Los datos de la factura no son válidos." }, { status: 409 });
  if (error.code === "42501") return NextResponse.json({ error: "Tu rol no tiene permiso para realizar esta acción." }, { status: 403 });
  if (["42P01", "PGRST205", "42703", "PGRST204"].includes(error.code ?? "")) {
    return NextResponse.json({ error: "Falta ejecutar en Supabase la migración 202611110002_facturas.sql." }, { status: 503 });
  }
  console.error(`Error de facturas (${context}):`, error);
  reportServerIncident(`api · facturas · ${context}`, error);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

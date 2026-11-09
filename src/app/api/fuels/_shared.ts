import { after, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { sendEmail } from "@/lib/email";
import { fmt, LEVEL_LABELS, RFC_PATTERN, SEMARNAT_LIMIT, type FuelMonthSummary } from "@/lib/fuels";
import { reportServerIncident } from "@/lib/incidents";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida.");
const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const percent = z.number().min(0).max(100);

export const productSchema = z.object({
  id: z.number().int().positive().nullable().optional(),
  name: text(120).min(2),
  calorific_value: z.number().min(0).max(20000),
  chlorine_pct: percent,
  water_pct: percent,
  sulfur_pct: percent,
});

export const supplierSchema = z.object({
  business_name: text(160).min(3),
  rfc: z.string().trim().toUpperCase().regex(RFC_PATTERN, "RFC no válido."),
  address: optionalText(300),
  contact_name: optionalText(120),
  phone: optionalText(30),
  email: z.email().max(160).nullable().optional().or(z.literal("")).transform((value) => value || null),
  permit_number: optionalText(80),
  permit_valid_until: day,
  // Ruta dentro del bucket privado fuel-permits (la sube el navegador antes de guardar).
  permit_path: z.string().regex(/^[\w-]+\.pdf$/).nullable().optional(),
  status: z.enum(["aprobado", "rechazado"]).default("aprobado"),
  status_note: optionalText(300),
  products: z.array(productSchema).min(1).max(30),
});

export const commercialSchema = z.object({
  scheme: z.enum(["cobro", "pago", "valor_cero"]),
  rate_per_ton: z.number().min(0).max(1_000_000),
});

export const scheduleSchema = z.object({
  scheduled_on: day,
  product_id: z.number().int().positive(),
  carrier: text(120).min(2),
  estimated_tons: z.number().positive().max(80),
  notes: text(300).optional(),
});

export const cancelSchema = z.object({ action: z.literal("cancel"), reason: text(300).min(3) });

export const entrySchema = z.object({
  schedule_id: z.number().int().positive(),
  manifest_folio: text(40).min(1),
  carrier: text(120).min(2),
  driver: text(120).min(2),
  plates: text(20).min(3),
  vehicle: text(120).optional(),
  destination: text(120).optional(),
  gross_kg: z.number().positive().max(80_000),
  notes: text(300).optional(),
});

export const receptionActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("exit"),
    tare_kg: z.number().positive().max(80_000),
    chlorine_pct: percent.nullable().optional(),
    compensates_id: z.number().int().positive().nullable().optional(),
  }),
  z.object({ action: z.literal("cancel"), reason: text(300).min(3) }),
  z.object({ action: z.literal("chlorine"), chlorine_pct: percent }),
]);

export const cokeSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Mes no válido."),
  coke_tons: z.number().min(0).max(1_000_000),
  notes: text(300).optional(),
});

export const parseId = (raw: string) => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

/** Traduce errores de la base (incluidos los mensajes de las funciones fuel_*) a respuestas claras. */
export function fuelDatabaseError(error: { code?: string; message: string }, context: string) {
  if (error.code === "23505") {
    const message = /manifest/i.test(error.message)
      ? "Ese folio de manifiesto ya está amarrado a otro ticket de báscula."
      : /rfc/i.test(error.message)
        ? "Ya existe un proveedor con ese RFC."
        : /compensates/i.test(error.message)
          ? "Ese embarque ya fue corregido."
          : "Ya existe un registro con esos datos.";
    return NextResponse.json({ error: message }, { status: 409 });
  }
  if (error.code === "23514") {
    return NextResponse.json({ error: "Los datos no pasan las reglas del módulo (análisis o pesos)." }, { status: 409 });
  }
  if (error.code === "P0001" || error.code === "42501") {
    return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }
  if (["42P01", "PGRST205", "PGRST202", "42883"].includes(error.code ?? "")) {
    return NextResponse.json(
      { error: "Falta ejecutar en Supabase la migración 202611100001_combustibles_alternos.sql." },
      { status: 503 },
    );
  }
  console.error(`Error de combustibles alternos (${context}):`, error);
  reportServerIncident(`api · combustibles · ${context}`, error);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

type PageResult<T> = { data: T[] | null; error: { code?: string; message: string } | null };
const BATCH = 1000;

/** Lee todas las filas en bloques de 1000 (límite de Supabase por consulta). */
export async function readAll<T>(readPage: (from: number, to: number) => PromiseLike<PageResult<T>>, max = 20_000) {
  const rows: T[] = [];
  while (rows.length < max) {
    const { data, error } = await readPage(rows.length, rows.length + BATCH - 1);
    if (error) return { rows, error };
    rows.push(...(data ?? []));
    if ((data ?? []).length < BATCH) break;
  }
  return { rows, error: null };
}

/**
 * Semáforo amarillo o rojo: correo a Ecología (una vez por mes y nivel; la base lleva el control).
 * Destinatarios en ECOLOGY_EMAIL_TO (separados por coma). Se envía después de responder.
 */
export function notifyEcology(client: SupabaseClient, summary: FuelMonthSummary | null | undefined, actor: string) {
  if (!summary || (summary.level !== "amarillo" && summary.level !== "rojo")) return;
  const task = async () => {
    const { data: first, error } = await client.rpc("fuel_claim_alert", { p_month: `${summary.month}-01`, p_level: summary.level });
    if (error || first !== true) return;
    const red = summary.level === "rojo";
    const lines = [
      red
        ? `ALERTA CRÍTICA: la sustitución térmica de ${summary.month} llegó a ${fmt(summary.pct)} % (límite SEMARNAT ${SEMARNAT_LIMIT} %).`
        : `Alerta preventiva: la sustitución térmica de ${summary.month} va en ${fmt(summary.pct)} %. Dosifica la logística semanal para no rebasar el ${SEMARNAT_LIMIT} %.`,
      "",
      `Semáforo: ${LEVEL_LABELS[summary.level]}`,
      `Combustibles alternos: ${fmt(summary.alt_tons, 3)} t · ${fmt(summary.alt_gcal, 2)} Gcal`,
      `Coque de petróleo: ${fmt(summary.coke_tons, 2)} t · ${fmt(summary.coke_gcal, 2)} Gcal${summary.coke_estimated ? ` (estimado con ${summary.coke_month})` : ""}`,
      `Proyección con lo programado: ${fmt(summary.projected_pct)} % (${fmt(summary.pending_tons, 3)} t pendientes)`,
      "",
      `Último registro: ${actor}`,
      red ? "La agenda bloquea nuevas cargas del mes y los reportes llevan marca de auditoría roja." : "",
    ].filter((line, index, all) => line !== "" || all[index - 1] !== "");
    await sendEmail(
      (process.env.ECOLOGY_EMAIL_TO ?? "").split(","),
      `[SysNomQC] Semáforo SEMARNAT ${LEVEL_LABELS[summary.level].toUpperCase()} · ${summary.month} · ${fmt(summary.pct)} %`,
      lines.join("\n"),
    );
  };
  try {
    after(task);
  } catch {
    void task();
  }
}

export const toNumber = (value: unknown) => (value === null || value === undefined ? null : Number(value));

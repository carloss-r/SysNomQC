import { NextResponse } from "next/server";
import { z } from "zod";
import { SITES } from "@/lib/employees";
import { reportServerIncident } from "@/lib/incidents";
import type { Access } from "@/lib/permissions";

export const articleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  size: z.string().trim().max(20).nullable().optional().transform((value) => value || null),
  unit: z.string().trim().min(1).max(20).default("PIEZAS"),
  min_stock: z.number().int().min(0).max(100000),
  active: z.boolean().default(true),
  /** Al editar: sede a la que se aplica el mínimo. */
  site: z.enum(SITES).optional(),
});

const itemsSchema = z
  .array(z.object({ article_id: z.number().int().positive(), quantity: z.number().int().min(-100000).max(100000) }))
  .min(1)
  .max(60)
  .refine((items) => new Set(items.map((item) => item.article_id)).size === items.length, "Artículo repetido.");

export const movementSchema = z.object({
  site: z.enum(SITES),
  kind: z.enum(["ingreso", "entrega", "ajuste"]),
  items: itemsSchema,
  employee_id: z.uuid().nullable().optional(),
  // La fecha la pone el servidor (hoy); se acepta el campo solo por compatibilidad y se ignora.
  moved_on: z.string().optional(),
  notes: z.string().trim().max(500).optional(),
});

export const purchaseRequestSchema = z.object({
  site: z.enum(SITES),
  items: z
    .array(z.object({ article_id: z.number().int().positive(), quantity: z.number().int().min(1).max(100000) }))
    .min(1)
    .max(80)
    .refine((items) => new Set(items.map((item) => item.article_id)).size === items.length, "Artículo repetido."),
  notes: z.string().trim().max(500).optional(),
});

// "En compra" sale de registrar la compra y "Recibida" del conteo: aquí solo se cancela.
export const purchaseStatusSchema = z.object({
  status: z.literal("cancelada"),
  note: z.string().trim().max(300).optional(),
});

const quantitiesSchema = z
  .array(z.object({ article_id: z.number().int().positive(), quantity: z.number().int().min(0).max(100000) }))
  .min(1)
  .max(80)
  .refine((items) => new Set(items.map((item) => item.article_id)).size === items.length, "Artículo repetido.");

/** Compras: cantidad comprada de cada artículo de la solicitud. */
export const purchaseBuySchema = z.object({ items: quantitiesSchema, note: z.string().trim().max(300).optional() });

/** Seguridad: conteo de lo que llegó (uno o varios artículos). */
export const purchaseCountSchema = z.object({ items: quantitiesSchema, note: z.string().trim().max(300).optional() });

/**
 * Sede con la que se trabaja en esta petición. Una cuenta con sede asignada solo puede usar la suya
 * (la base de datos lo vuelve a validar con can_access_site); las demás eligen y por omisión Campeche.
 */
export function resolveSite(access: Access, requested: string | null | undefined): { site: string } | { response: NextResponse } {
  const valid = (SITES as readonly string[]).includes(requested ?? "");
  if (access.site && !access.is_super_admin) {
    if (requested && requested !== access.site) {
      return { response: NextResponse.json({ error: `Tu cuenta solo tiene acceso al inventario de ${access.site}.` }, { status: 403 }) };
    }
    return { site: access.site };
  }
  if (requested && !valid) return { response: NextResponse.json({ error: "Sede no válida." }, { status: 400 }) };
  return { site: valid ? (requested as string) : SITES[0] };
}

/** Traduce errores de la base (incluidos los mensajes de las funciones de EPP) a respuestas claras. */
export function eppDatabaseError(error: { code?: string; message: string }, context: string) {
  if (error.code === "23505") {
    return NextResponse.json({ error: "Ya existe un artículo con ese nombre y talla." }, { status: 409 });
  }
  if (error.code === "P0001" || error.code === "42501") {
    // Mensajes escritos por nosotros en la función SQL (existencia insuficiente, permisos, validaciones).
    return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }
  if (["42P01", "42703", "PGRST205", "PGRST202", "PGRST204", "42883"].includes(error.code ?? "")) {
    return NextResponse.json(
      { error: "Falta ejecutar en Supabase las migraciones de EPP (hasta 202611130001_compras_conteo_ciego.sql)." },
      { status: 503 },
    );
  }
  console.error(`Error de EPP (${context}):`, error);
  reportServerIncident(`api · epp · ${context}`, error);
  return NextResponse.json({ error: "No se pudo completar la operación de EPP." }, { status: 500 });
}

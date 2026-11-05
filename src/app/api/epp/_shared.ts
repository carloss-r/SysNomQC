import { NextResponse } from "next/server";
import { z } from "zod";
import { reportServerIncident } from "@/lib/incidents";

export const articleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  category: z.string().trim().min(2).max(60),
  size: z.string().trim().max(20).nullable().optional().transform((value) => value || null),
  unit: z.string().trim().min(1).max(20).default("PIEZAS"),
  min_stock: z.number().int().min(0).max(100000),
  active: z.boolean().default(true),
});

export const movementSchema = z.object({
  kind: z.enum(["ingreso", "entrega", "ajuste"]),
  items: z
    .array(z.object({ article_id: z.number().int().positive(), quantity: z.number().int().min(-100000).max(100000) }))
    .min(1)
    .max(60),
  employee_id: z.uuid().nullable().optional(),
  moved_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(500).optional(),
});

/** Traduce errores de la base (incluidos los mensajes de epp_apply) a respuestas claras. */
export function eppDatabaseError(error: { code?: string; message: string }, context: string) {
  if (error.code === "23505") {
    return NextResponse.json({ error: "Ya existe un artículo con ese nombre." }, { status: 409 });
  }
  if (error.code === "P0001" || error.code === "42501") {
    // Mensajes escritos por nosotros en la función SQL (existencia insuficiente, permisos, validaciones).
    return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }
  console.error(`Error de EPP (${context}):`, error);
  reportServerIncident(`api · epp · ${context}`, error);
  return NextResponse.json({ error: "No se pudo completar la operación de EPP." }, { status: 500 });
}

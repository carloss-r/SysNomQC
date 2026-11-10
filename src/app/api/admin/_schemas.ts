import { z } from "zod";
import { SITES } from "@/lib/employees";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import { roleLabel } from "@/lib/roles";

/** null = todas las sedes. */
export const userSiteSchema = z.enum(SITES).nullable();

export const roleSchema = z
  .object({
    // Nombre legible: "EncargadoCompras" se guarda como "Encargado de compras".
    name: z.string().trim().min(2).max(60).transform((value) => roleLabel(value.replace(/\s+/g, " "))),
    description: z.string().trim().max(200).nullable(),
    permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(60),
  })
  .strict();

/** Uno o varios roles; el primero queda como rol principal. */
export const roleIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(10)
  .transform((ids) => Array.from(new Set(ids)));

export const userCreateSchema = z
  .object({
    email: z.email().max(150),
    full_name: z.string().trim().min(1).max(150),
    password: z.string().min(12).max(72),
    role_ids: roleIdsSchema,
    active: z.boolean(),
    site: userSiteSchema.optional(),
  })
  .strict();

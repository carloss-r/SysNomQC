import { z } from "zod";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";

export const roleSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(200).nullable(),
    permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(20),
  })
  .strict();

/** Nombre de usuario para iniciar sesión (opcional): 3-30 caracteres, sin "@". */
export const usernameSchema = z.string().trim().regex(/^[A-Za-z0-9._-]{3,30}$/);

export const userCreateSchema = z
  .object({
    email: z.email().max(150),
    username: usernameSchema.optional(),
    full_name: z.string().trim().min(1).max(150),
    password: z.string().min(8).max(72),
    role_id: z.number().int().positive(),
    active: z.boolean(),
  })
  .strict();

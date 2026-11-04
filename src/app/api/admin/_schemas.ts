import { z } from "zod";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";

export const roleSchema = z
  .object({
    name: z.string().trim().min(2).max(60),
    description: z.string().trim().max(200).nullable(),
    permissions: z.array(z.enum(ALL_PERMISSIONS as [Permission, ...Permission[]])).max(20),
  })
  .strict();

export const userCreateSchema = z
  .object({
    email: z.email().max(150),
    full_name: z.string().trim().min(1).max(150),
    password: z.string().min(8).max(72),
    role_id: z.uuid(),
    active: z.boolean(),
  })
  .strict();

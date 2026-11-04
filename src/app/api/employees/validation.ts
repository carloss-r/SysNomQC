import { z } from "zod";
import {
  CONTRACT_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  SITES,
} from "@/lib/employees";

export const employeeInputSchema = z
  .object({
    employee_code: z.string().trim().min(1).max(30),
    full_name: z.string().trim().min(1).max(150),
    site: z.enum(SITES),
    hire_date: z.iso.date(),
    position: z.string().trim().min(1).max(150),
    contract_type: z.enum(CONTRACT_TYPES),
    salary: z.number().finite().min(0).max(100_000_000),
    bank_account: z.string().trim().max(40).nullable(),
    active: z.boolean(),
    gender: z.enum(GENDERS).nullable(),
    nss: z.string().trim().max(11).nullable(),
    curp: z.string().trim().max(18).nullable(),
    rfc: z.string().trim().max(13).nullable(),
    marital_status: z.enum(MARITAL_STATUSES).nullable(),
    birth_date: z.iso.date().nullable(),
    credits: z.array(z.string().trim().min(1).max(80)).max(20),
    email: z.union([z.literal(""), z.email()]).nullable(),
    phone: z.string().trim().max(20).nullable(),
    residence_state: z.string().trim().max(80).nullable(),
    address: z.string().trim().max(500).nullable(),
    photo_path: z.string().trim().max(500).nullable(),
  })
  .strict();

export const employeePatchSchema = employeeInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Debes enviar al menos un campo.")
  .strict();

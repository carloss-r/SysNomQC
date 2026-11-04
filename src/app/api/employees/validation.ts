import { z } from "zod";
import { CONTRACT_TYPES } from "@/lib/employees";

const id = z.number().int().positive();
const optionalText = (max: number) => z.string().trim().max(max).nullable();

// Ruta dentro del bucket: sin carpetas relativas ni barras iniciales.
const photoPath = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !value.includes("..") && !value.startsWith("/"), "Ruta de foto no válida.")
  .nullable();

const creditSchema = z
  .object({
    credit_type_id: id,
    credit_number: optionalText(40),
    monthly_discount: z.number().finite().min(0).max(100_000_000),
  })
  .strict();

export const employeeInputSchema = z
  .object({
    employee_code: z.string().trim().min(1).max(30),
    full_name: z.string().trim().min(1).max(150),
    site_id: id,
    position_id: id,
    hire_date: z.iso.date(),
    contract_type: z.enum(CONTRACT_TYPES),
    salary: z.number().finite().min(0).max(100_000_000),
    bank_account: optionalText(40),
    clabe: z.string().trim().regex(/^\d{18}$/, "La CLABE debe tener 18 dígitos.").nullable(),
    active: z.boolean(),
    gender_id: id.nullable(),
    marital_status_id: id.nullable(),
    nss: optionalText(11),
    curp: optionalText(18),
    rfc: optionalText(13),
    birth_date: z.iso.date().nullable(),
    email: z.union([z.literal(""), z.email()]).nullable(),
    phone: optionalText(20),
    residence_state: optionalText(80),
    residence_city: optionalText(80),
    postal_code: optionalText(10),
    address: optionalText(500),
    photo_path: photoPath,
    credits: z
      .array(creditSchema)
      .max(10)
      .refine(
        (credits) => new Set(credits.map((credit) => credit.credit_type_id)).size === credits.length,
        "No repitas el mismo tipo de crédito.",
      ),
  })
  .strict();

export const employeePatchSchema = employeeInputSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Debes enviar al menos un campo.")
  .strict();

export const employeeIdSchema = z.coerce.number().int().positive();

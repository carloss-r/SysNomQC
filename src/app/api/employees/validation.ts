import { z } from "zod";
import {
  CONTRACT_TYPES,
  GENDERS,
  MARITAL_STATUSES,
  SITES,
} from "@/lib/employees";
import { safeText, storagePathSchema } from "@/lib/safe-input";

/** Nombre visible de cada campo, para decir en el error cuál está mal. */
export const EMPLOYEE_FIELD_LABELS: Record<string, string> = {
  employee_code: "ID empleado",
  full_name: "Nombre completo",
  site: "Sede",
  hire_date: "Fecha de ingreso",
  area_id: "Área global",
  position: "Puesto",
  assignment: "Asignación",
  contract_type: "Tipo de contrato",
  salary: "Salario",
  contribution_salary: "Salario de cotización",
  bank_account: "Cuenta bancaria",
  active: "Estatus",
  gender: "Género",
  nss: "NSS (11 dígitos)",
  curp: "CURP (18 caracteres)",
  rfc: "RFC",
  marital_status: "Estado civil",
  birth_date: "Fecha de nacimiento",
  credits: "Créditos",
  email: "Correo",
  phone: "Teléfono",
  residence_state: "Estado de residencia",
  address: "Domicilio",
  photo_path: "Foto",
  observations: "Observaciones",
};

/** Mensaje claro a partir de los errores de validación: qué campos revisar. */
export function employeeValidationMessage(error: z.ZodError): string {
  const fields = Array.from(
    new Set(
      error.issues.map((issue) => {
        const key = String(issue.path[0] ?? "");
        if (issue.code === "unrecognized_keys") return issue.keys.includes("employee_code") ? "ID empleado (no se puede cambiar)" : "campos no permitidos";
        return EMPLOYEE_FIELD_LABELS[key] ?? key;
      }),
    ),
  ).filter(Boolean);
  return fields.length ? `Revisa estos campos: ${fields.join(", ")}.` : "Revisa los campos obligatorios y el formato de los datos.";
}

const nullableText = (max: number, multiline = false) => safeText(max, { multiline }).nullable();

/**
 * Datos del expediente que se pueden capturar. El ID de empleado NO está aquí: al dar de alta lo asigna
 * el servidor (siguiente QG-n) y después ya no se puede cambiar.
 */
const employeeFields = z.object({
  full_name: safeText(150, { min: 1 }),
  site: z.enum(SITES),
  hire_date: z.iso.date(),
  // Área global (CYM / CAL). La base valida que sea de la misma sede y que no falte si la sede tiene áreas.
  area_id: z.number().int().positive().nullable().optional(),
  // Puesto y asignación se mandan por nombre: la base los liga a su catálogo (y los da de alta si son nuevos).
  position: safeText(150, { min: 1 }),
  assignment: nullableText(150).optional(),
  contract_type: z.enum(CONTRACT_TYPES),
  salary: z.number().finite().min(0).max(100_000_000),
  contribution_salary: z.number().finite().min(0).max(100_000_000).nullable().optional(),
  bank_account: z.string().trim().regex(/^[0-9 -]{4,40}$/).nullable(),
  active: z.boolean(),
  gender: z.enum(GENDERS).nullable(),
  nss: z.string().trim().regex(/^\d{11}$/).nullable(),
  curp: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{18}$/).nullable(),
  rfc: z.string().trim().toUpperCase().regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/).nullable(),
  marital_status: z.enum(MARITAL_STATUSES).nullable(),
  birth_date: z.iso.date().nullable(),
  credits: z.array(safeText(80, { min: 1 })).max(20),
  email: z.union([z.literal(""), z.email().max(150)]).nullable(),
  phone: z.string().trim().regex(/^[0-9 +()-]{7,20}$/).nullable(),
  residence_state: nullableText(80),
  address: nullableText(500, true),
  photo_path: storagePathSchema.nullable(),
  observations: nullableText(1000, true).optional(),
});

/** Alta: el cliente no manda el ID; si lo manda, se rechaza (strict). */
export const employeeInputSchema = employeeFields.strict();

/** Edición: cualquier campo del expediente menos el ID de empleado. */
export const employeePatchSchema = employeeFields
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Debes enviar al menos un campo.");

/** Baja: el día lo captura el usuario; el motivo es opcional. La fecha de registro la pone la base. */
export const terminationSchema = z
  .object({
    termination_date: z.iso.date(),
    termination_reason: safeText(500).optional(),
  })
  .strict();

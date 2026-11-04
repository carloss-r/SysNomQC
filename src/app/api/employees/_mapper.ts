import type { SupabaseClient } from "@supabase/supabase-js";
import type { Employee, EmployeeCreditInput, EmployeeInput, EmployeeSummary } from "@/lib/employees";

// Las tablas reales son public.empleados + catálogos (sedes, areas, puestos, …). Aquí se traduce
// entre esas columnas en español y los nombres que usa la interfaz.

type Named = { nombre: string } | null;

type EmployeeRow = {
  id_empleado: number;
  codigo_empleado: string;
  nombre_completo: string;
  id_sede: number;
  id_puesto: number;
  id_genero: number | null;
  id_estado_civil: number | null;
  fecha_contratacion: string;
  tipo_contrato: string;
  salario_actual: number | string | null;
  num_cuenta_bancaria: string | null;
  clabe_interbancaria: string | null;
  activo: boolean | null;
  nss: string | null;
  curp: string | null;
  rfc: string | null;
  fecha_nacimiento: string | null;
  email: string | null;
  telefono: string | null;
  estado_residencia: string | null;
  ciudad_residencia: string | null;
  codigo_postal: string | null;
  direccion_calle: string | null;
  foto_perfil_url: string | null;
  creado_en: string | null;
  actualizado_en: string | null;
  sede: Named;
  puesto: { id_area: number; nombre: string; area: Named } | null;
  genero: Named;
  estado_civil: Named;
  creditos: {
    id_tipo_credito: number;
    numero_credito: string;
    descuento_mensual: number | string | null;
    estatus: string | null;
    tipo: Named;
  }[];
};

type SummaryRow = {
  id_empleado: number;
  codigo_empleado: string;
  nombre_completo: string;
  tipo_contrato: string;
  activo: boolean | null;
  email: string | null;
  sede: Named;
  puesto: { nombre: string; area: Named } | null;
};

export const EMPLOYEE_SELECT = [
  "*",
  "sede:sedes(nombre)",
  "puesto:puestos(id_area,nombre,area:areas(nombre))",
  "genero:catalogos_generos(nombre)",
  "estado_civil:catalogos_estados_civiles(nombre)",
  "creditos:empleados_creditos(id_tipo_credito,numero_credito,descuento_mensual,estatus,tipo:catalogos_tipos_credito(nombre))",
].join(",");

export const EMPLOYEE_LIST_SELECT = [
  "id_empleado",
  "codigo_empleado",
  "nombre_completo",
  "tipo_contrato",
  "activo",
  "email",
  "sede:sedes(nombre)",
  "puesto:puestos(nombre,area:areas(nombre))",
].join(",");

export function toEmployee(row: EmployeeRow): Employee {
  return {
    id: row.id_empleado,
    employee_code: row.codigo_empleado,
    full_name: row.nombre_completo,
    site_id: row.id_sede,
    site: row.sede?.nombre ?? "",
    area_id: row.puesto?.id_area ?? 0,
    area: row.puesto?.area?.nombre ?? "",
    position_id: row.id_puesto,
    position: row.puesto?.nombre ?? "",
    hire_date: row.fecha_contratacion,
    contract_type: row.tipo_contrato,
    salary: Number(row.salario_actual ?? 0),
    bank_account: row.num_cuenta_bancaria,
    clabe: row.clabe_interbancaria,
    active: row.activo ?? true,
    gender_id: row.id_genero,
    gender: row.genero?.nombre ?? null,
    marital_status_id: row.id_estado_civil,
    marital_status: row.estado_civil?.nombre ?? null,
    nss: row.nss,
    curp: row.curp,
    rfc: row.rfc,
    birth_date: row.fecha_nacimiento,
    email: row.email,
    phone: row.telefono,
    residence_state: row.estado_residencia,
    residence_city: row.ciudad_residencia,
    postal_code: row.codigo_postal,
    address: row.direccion_calle,
    photo_path: row.foto_perfil_url,
    credits: (row.creditos ?? []).map((credit) => ({
      credit_type_id: credit.id_tipo_credito,
      credit_type: credit.tipo?.nombre ?? "",
      credit_number: credit.numero_credito,
      monthly_discount: Number(credit.descuento_mensual ?? 0),
      status: credit.estatus ?? "ACTIVO",
    })),
    created_at: row.creado_en,
    updated_at: row.actualizado_en,
  };
}

export function toSummary(row: SummaryRow): EmployeeSummary {
  return {
    id: row.id_empleado,
    employee_code: row.codigo_empleado,
    full_name: row.nombre_completo,
    site: row.sede?.nombre ?? "",
    area: row.puesto?.area?.nombre ?? "",
    position: row.puesto?.nombre ?? "",
    contract_type: row.tipo_contrato,
    active: row.activo ?? true,
    email: row.email,
  };
}

const COLUMN_BY_FIELD = {
  employee_code: "codigo_empleado",
  full_name: "nombre_completo",
  site_id: "id_sede",
  position_id: "id_puesto",
  hire_date: "fecha_contratacion",
  contract_type: "tipo_contrato",
  salary: "salario_actual",
  bank_account: "num_cuenta_bancaria",
  clabe: "clabe_interbancaria",
  active: "activo",
  gender_id: "id_genero",
  marital_status_id: "id_estado_civil",
  nss: "nss",
  curp: "curp",
  rfc: "rfc",
  birth_date: "fecha_nacimiento",
  email: "email",
  phone: "telefono",
  residence_state: "estado_residencia",
  residence_city: "ciudad_residencia",
  postal_code: "codigo_postal",
  address: "direccion_calle",
  photo_path: "foto_perfil_url",
} as const satisfies Partial<Record<keyof EmployeeInput, string>>;

/** Columnas de public.empleados a partir de los campos recibidos (sin los créditos). */
export function toEmployeeColumns(input: Partial<EmployeeInput>): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  for (const [field, column] of Object.entries(COLUMN_BY_FIELD)) {
    const value = input[field as keyof typeof COLUMN_BY_FIELD];
    if (value !== undefined) columns[column] = value;
  }
  return columns;
}

type DbError = { code?: string; message: string };

/** Deja en public.empleados_creditos exactamente los tipos de crédito indicados. */
export async function syncCredits(
  client: SupabaseClient,
  employeeId: number,
  credits: EmployeeCreditInput[],
): Promise<DbError | null> {
  const { data: existing, error: readError } = await client
    .from("empleados_creditos")
    .select("id_empleado_credito,id_tipo_credito")
    .eq("id_empleado", employeeId);
  if (readError) return readError;

  const existingByType = new Map<number, number>(
    (existing ?? []).map((row) => [row.id_tipo_credito as number, row.id_empleado_credito as number]),
  );
  const wantedTypes = new Set(credits.map((credit) => credit.credit_type_id));

  const removedIds = [...existingByType.entries()]
    .filter(([typeId]) => !wantedTypes.has(typeId))
    .map(([, rowId]) => rowId);
  if (removedIds.length > 0) {
    const { error } = await client.from("empleados_creditos").delete().in("id_empleado_credito", removedIds);
    if (error) return error;
  }

  for (const credit of credits) {
    const values = {
      numero_credito: credit.credit_number ?? "S/N",
      descuento_mensual: credit.monthly_discount,
    };
    const rowId = existingByType.get(credit.credit_type_id);
    const { error } = rowId
      ? await client.from("empleados_creditos").update(values).eq("id_empleado_credito", rowId)
      : await client.from("empleados_creditos").insert({
          ...values,
          id_empleado: employeeId,
          id_tipo_credito: credit.credit_type_id,
        });
    if (error) return error;
  }

  return null;
}

export async function fetchEmployee(
  client: SupabaseClient,
  employeeId: number,
): Promise<{ employee: Employee | null; error: DbError | null }> {
  const { data, error } = await client
    .from("empleados")
    .select(EMPLOYEE_SELECT)
    .eq("id_empleado", employeeId)
    .maybeSingle();
  if (error) return { employee: null, error };
  return { employee: data ? toEmployee(data as unknown as EmployeeRow) : null, error: null };
}

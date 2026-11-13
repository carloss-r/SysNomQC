export const SITES = ["Campeche", "Lagunas", "Cruz Azul", "El Carmen"] as const;

// Solo son sugerencias para autocompletar; el campo acepta cualquier texto.
export const POSITIONS = [
  "Operaciones - Operador Especializado",
  "Mantenimiento - Técnico Mecánico",
  "Logística - Coordinador de Transportes",
  "Seguridad Industrial - Supervisor EHS",
  "Administración - Contador General",
  "Recursos Humanos - Generalista",
  "Calidad - Analista de Procesos",
] as const;

export const CONTRACT_TYPES = [
  "Indeterminado (Planta)",
  "Determinado (Eventual)",
  "Prueba / Capacitación",
] as const;

export const GENDERS = ["Masculino", "Femenino", "Otro", "Prefiero no especificar"] as const;

export const MARITAL_STATUSES = [
  "Soltero(a)",
  "Casado(a)",
  "Divorciado(a)",
  "Unión Libre",
  "Viudo(a)",
] as const;

export type Employee = {
  id: string;
  employee_code: string;
  full_name: string;
  site: string;
  hire_date: string;
  position: string;
  /** Asignación (texto libre); null = sin capturar. */
  assignment: string | null;
  contract_type: string;
  /** Salario base (MXN). */
  salary: number;
  /** Salario de cotización (MXN); vacío hasta que se capture. */
  contribution_salary: number | null;
  bank_account: string | null;
  active: boolean;
  /** Día de baja capturado por el usuario. */
  termination_date: string | null;
  termination_reason: string | null;
  /** Cuándo se registró la baja en el sistema (lo pone la base). */
  terminated_at: string | null;
  terminated_by_name: string | null;
  gender: string | null;
  nss: string | null;
  curp: string | null;
  rfc: string | null;
  marital_status: string | null;
  birth_date: string | null;
  credits: string[];
  email: string | null;
  phone: string | null;
  residence_state: string | null;
  address: string | null;
  photo_path: string | null;
  /** Observaciones del expediente: faltantes o detalles a dar seguimiento. */
  observations: string | null;
  /** Lo sella la base al cambiar la observación. */
  observations_updated_at: string | null;
  observations_updated_by_name: string | null;
  created_at: string;
  updated_at: string;
};

// La tabla principal solo necesita estas columnas: la lista viaja ligera y el expediente
// completo (salario, CURP, NSS, etc.) se pide únicamente al abrir un empleado.
export const EMPLOYEE_LIST_COLUMNS =
  "id,employee_code,full_name,site,position,contract_type,active,email";

export type EmployeeSummary = Pick<
  Employee,
  "id" | "employee_code" | "full_name" | "site" | "position" | "contract_type" | "active" | "email"
> &
  // Solo llegan en la pestaña de seguimiento de expedientes.
  Partial<Pick<Employee, "observations" | "observations_updated_at" | "observations_updated_by_name">>;

/** Columnas de la pestaña "Seguimiento de expedientes". */
export const EMPLOYEE_FOLLOWUP_COLUMNS = `${EMPLOYEE_LIST_COLUMNS},observations,observations_updated_at,observations_updated_by_name`;

export const toEmployeeSummary = (employee: Employee): EmployeeSummary => ({
  id: employee.id,
  employee_code: employee.employee_code,
  full_name: employee.full_name,
  site: employee.site,
  position: employee.position,
  contract_type: employee.contract_type,
  active: employee.active,
  email: employee.email,
});

export const sortEmployees = (list: EmployeeSummary[]) =>
  [...list].sort((a, b) => a.full_name.localeCompare(b.full_name, "es-MX"));

// La baja se registra por separado (/api/employees/[id]/baja), no desde el formulario.
export type EmployeeInput = Omit<
  Employee,
  | "id"
  | "created_at"
  | "updated_at"
  | "termination_date"
  | "termination_reason"
  | "terminated_at"
  | "terminated_by_name"
  | "observations_updated_at"
  | "observations_updated_by_name"
>;

export type EmployeeFormValues = {
  employee_code: string;
  full_name: string;
  site: string;
  hire_date: string;
  position: string;
  assignment: string;
  contract_type: string;
  salary: string;
  contribution_salary: string;
  bank_account: string;
  active: boolean;
  gender: string;
  nss: string;
  curp: string;
  rfc: string;
  marital_status: string;
  birth_date: string;
  credits: string[];
  email: string;
  phone: string;
  residence_state: string;
  address: string;
  observations: string;
};

export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  employee_code: "",
  full_name: "",
  site: SITES[0],
  hire_date: "",
  position: "",
  assignment: "",
  contract_type: CONTRACT_TYPES[0],
  salary: "",
  contribution_salary: "",
  bank_account: "",
  active: true,
  gender: "",
  nss: "",
  curp: "",
  rfc: "",
  marital_status: "",
  birth_date: "",
  credits: [],
  email: "",
  phone: "",
  residence_state: "",
  address: "",
  observations: "",
};

const optionalValue = (value: string) => value.trim() || null;

export function formToEmployeeInput(
  form: EmployeeFormValues,
  photoPath: string | null,
): EmployeeInput {
  return {
    employee_code: form.employee_code.trim().toUpperCase(),
    full_name: form.full_name.trim(),
    site: form.site,
    hire_date: form.hire_date,
    position: form.position.trim(),
    assignment: optionalValue(form.assignment),
    contract_type: form.contract_type,
    salary: Number(form.salary) || 0,
    contribution_salary: form.contribution_salary.trim() === "" ? null : Number(form.contribution_salary) || 0,
    bank_account: optionalValue(form.bank_account),
    active: form.active,
    gender: optionalValue(form.gender),
    nss: optionalValue(form.nss),
    curp: optionalValue(form.curp)?.toUpperCase() ?? null,
    rfc: optionalValue(form.rfc)?.toUpperCase() ?? null,
    marital_status: optionalValue(form.marital_status),
    birth_date: optionalValue(form.birth_date),
    credits: form.credits,
    email: optionalValue(form.email),
    phone: optionalValue(form.phone),
    residence_state: optionalValue(form.residence_state),
    address: optionalValue(form.address),
    photo_path: photoPath,
    observations: optionalValue(form.observations),
  };
}

export function employeeToForm(employee: Employee): EmployeeFormValues {
  return {
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    site: employee.site,
    hire_date: employee.hire_date,
    position: employee.position,
    assignment: employee.assignment ?? "",
    contract_type: employee.contract_type,
    salary: String(employee.salary),
    contribution_salary: employee.contribution_salary === null || employee.contribution_salary === undefined ? "" : String(employee.contribution_salary),
    bank_account: employee.bank_account ?? "",
    active: employee.active,
    gender: employee.gender ?? "",
    nss: employee.nss ?? "",
    curp: employee.curp ?? "",
    rfc: employee.rfc ?? "",
    marital_status: employee.marital_status ?? "",
    birth_date: employee.birth_date ?? "",
    credits: employee.credits ?? [],
    email: employee.email ?? "",
    phone: employee.phone ?? "",
    residence_state: employee.residence_state ?? "",
    address: employee.address ?? "",
    observations: employee.observations ?? "",
  };
}

export function formatDate(date: string | null) {
  if (!date) return "No especificada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function formatDateTime(value: string | null) {
  if (!value) return "No especificada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: "America/Merida" }).format(new Date(value));
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(amount);
}

export const SITES = ["Campeche", "Lagunas", "Cruz Azul"] as const;

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
  contract_type: string;
  salary: number;
  bank_account: string | null;
  active: boolean;
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
>;

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

export type EmployeeInput = Omit<Employee, "id" | "created_at" | "updated_at">;

export type EmployeeFormValues = {
  employee_code: string;
  full_name: string;
  site: string;
  hire_date: string;
  position: string;
  contract_type: string;
  salary: string;
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
};

export const EMPTY_EMPLOYEE_FORM: EmployeeFormValues = {
  employee_code: "",
  full_name: "",
  site: SITES[0],
  hire_date: "",
  position: "",
  contract_type: CONTRACT_TYPES[0],
  salary: "",
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
    contract_type: form.contract_type,
    salary: Number(form.salary) || 0,
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
  };
}

export function employeeToForm(employee: Employee): EmployeeFormValues {
  return {
    employee_code: employee.employee_code,
    full_name: employee.full_name,
    site: employee.site,
    hire_date: employee.hire_date,
    position: employee.position,
    contract_type: employee.contract_type,
    salary: String(employee.salary),
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
  };
}

export function formatDate(date: string | null) {
  if (!date) return "No especificada";
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

export function formatCurrency(amount: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(amount);
}
